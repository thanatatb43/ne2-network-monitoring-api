const { NetworkDevices, LatencyLogs, LatencyRecent, DeviceMetrics, Sequelize } = require('../models');
const { Op } = Sequelize;
const ping = require('ping');
const { sendTeamsNotification } = require('./notificationService');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Service to ping all network devices in a continuous staggered loop.
 * This prevents resource spikes and eliminates false offline reports by:
 * 1. Pinging only 10 devices at a time.
 * 2. Waiting 2 seconds between batches.
 * 3. Using 3 packets and a 5s timeout per probe.
 */
const startContinuousPingLoop = async () => {
  console.log(`[PingLoop] Initializing continuous monitoring loop...`);

  while (true) {
    try {
      // Pause pinging between 12:00 AM and 5:00 AM
      const currentHour = new Date().getHours();
      if (currentHour >= 0 && currentHour < 5) {
        console.log(`[PingLoop] Paused between 12:00 AM and 5:00 AM (Current hour: ${currentHour}). Waiting 15 minutes...`);
        await new Promise(resolve => setTimeout(resolve, 15 * 60 * 1000));
        continue;
      }

      const devices = await NetworkDevices.findAll();
      const offsetHours = process.env.DB_TIMEZONE_OFFSET !== undefined ? parseInt(process.env.DB_TIMEZONE_OFFSET) : 0;
      
      const batchSize = 10;
      console.log(`[PingLoop] Starting new cycle for ${devices.length} devices (Batch size: ${batchSize})`);

      for (let i = 0; i < devices.length; i += batchSize) {
        const batchPre = devices.slice(i, i + batchSize);
        const checkedAt = new Date(new Date().getTime() + offsetHours * 60 * 60 * 1000);
        
        // 1. Refetch batch to ensure they still exist (and get latest data)
        const batch = await NetworkDevices.findAll({
          where: { id: { [Op.in]: batchPre.map(d => d.id) } }
        });

        if (batch.length === 0) {
          console.log(`[PingLoop] Batch ${Math.floor(i/batchSize) + 1}: All devices in this batch were deleted. Skipping.`);
          continue;
        }

        console.log(`[PingLoop] Batch ${Math.floor(i/batchSize) + 1}: Pinging ${batch.map(d => d.pea_name).join(', ')}`);

        // Fetch previous statuses to detect changes
        const previousMetrics = await DeviceMetrics.findAll({
          where: { device_id: { [Op.in]: batch.map(d => d.id) } },
          raw: true
        });
        const statusMap = previousMetrics.reduce((acc, m) => {
          acc[m.device_id] = m.status;
          return acc;
        }, {});

        const batchPromises = batch.map(async (device) => {
          if (!device.gateway) {
            return {
              device_id: device.id,
              latency_ms: null,
              packet_loss: 100,
              status: 'down',
              checked_at: checkedAt
            };
          }

          try {
            // Probes the gateway, falling back to the FortiGate WAN IP if the
            // gateway doesn't answer. Shared by the initial attempt and the retry
            // below so both go through the exact same up/down logic. A thrown
            // error (e.g. the ping process itself failing to spawn/timeout at the
            // OS level) is treated as "not alive" rather than being left to escape
            // to the outer catch - that outer catch skips the retry AND the
            // notification/DeviceDowntime logging below entirely, which previously
            // let devices flip to "down" with zero notification and zero history,
            // then silently resurface later with a stale duration borrowed from an
            // unrelated past incident.
            const probeOnce = async () => {
              try {
                let res = await ping.promise.probe(device.gateway, {
                  timeout: 5,
                  extra: ['-n', '3']
                });

                if (!res.alive && device.wan_ip_fgt) {
                  const fallbackRes = await ping.promise.probe(device.wan_ip_fgt, {
                    timeout: 5,
                    extra: ['-n', '3']
                  });
                  if (fallbackRes.alive) {
                    res = fallbackRes;
                    console.log(`[PingLoop] ${device.pea_name}: Gateway down, but wan_ip_fgt is UP. Marking as UP.`);
                  }
                }

                return res;
              } catch (probeErr) {
                console.error(`[PingLoop] Probe error for ${device.pea_name} (${device.gateway}):`, probeErr.message);
                return { alive: false };
              }
            };

            let res = await probeOnce();

            // A device only gets ~1 check per ~20min cycle, so a single failed probe
            // (transient packet loss, not a real outage) was showing up as a false
            // "down" for the whole cycle. Give it one more try a few seconds later
            // before believing it - a real outage will still fail both attempts.
            if (!res.alive) {
              await sleep(3000);
              res = await probeOnce();
            }

            const newStatus = res.alive ? 'up' : 'down';

            // Detect status change and notify
            const prevStatus = statusMap[device.id];

            // Fix: Notify if status changed, or if it's the first detection and the device is down
            if (newStatus !== prevStatus) {
              if (prevStatus !== undefined || newStatus === 'down') {
                // Notification is async, we don't await it here to avoid slowing down the loop
                sendTeamsNotification(device, newStatus, prevStatus);
              }
            }

            return {
              device_id: device.id,
              latency_ms: res.alive ? parseFloat(res.avg) : null,
              packet_loss: res.alive ? (res.packetLoss ? parseFloat(res.packetLoss) : 0) : 100,
              status: newStatus,
              checked_at: checkedAt
            };
          } catch (err) {
            console.error(`[PingLoop] Error pinging ${device.pea_name} (${device.gateway}):`, err);
            return {
              device_id: device.id,
              latency_ms: null,
              packet_loss: 100,
              status: 'down',
              checked_at: checkedAt
            };
          }
        });


        const batchResults = await Promise.all(batchPromises);
        
        if (batchResults.length > 0) {
          // Double check if all device_ids still exist in DB to avoid FK constraint error
          // (They could be deleted while pinging)
          const currentExistIds = (await NetworkDevices.findAll({
            where: { id: { [Op.in]: batchResults.map(r => r.device_id) } },
            attributes: ['id'],
            raw: true
          })).map(d => d.id);

          const filteredResults = batchResults.filter(r => currentExistIds.includes(r.device_id));

          if (filteredResults.length > 0) {
            await Promise.all([
              LatencyLogs.bulkCreate(filteredResults),
              LatencyRecent.bulkCreate(filteredResults),
              DeviceMetrics.bulkCreate(filteredResults, {
                updateOnDuplicate: ['latency_ms', 'packet_loss', 'status', 'checked_at']
              })
            ]);
          }
        }

        // Cleanup LatencyRecent: keep only last 130 mins (2+ hours)
        const cleanupThreshold = new Date(checkedAt.getTime() - 130 * 60 * 1000);
        await LatencyRecent.destroy({
          where: {
            checked_at: { [Op.lt]: cleanupThreshold }
          }
        });

        // Rest for 60 seconds between batches to strictly follow the "10 devices per minute" rule
        await new Promise(resolve => setTimeout(resolve, 60000));
      }


      console.log(`[PingLoop] Cycle complete. Waiting 10 seconds before next lap...`);
      await new Promise(resolve => setTimeout(resolve, 10000)); // 10s rest between full cycles

    } catch (error) {
      console.error('[PingLoop] Loop encountered an error:', error);
      await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s before retrying if DB fails
    }
  }
};

/**
 * Legacy runner (for manual triggers or verification)
 */
const runPingJob = async () => {
  console.log('[PingJob] Legacy runPingJob called. Consider using startContinuousPingLoop for live monitoring.');
};

module.exports = {
  runPingJob,
  startContinuousPingLoop
};
