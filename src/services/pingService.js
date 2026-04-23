const { NetworkDevices, LatencyLogs, LatencyRecent, DeviceMetrics, Sequelize } = require('../models');
const { Op } = Sequelize;
const ping = require('ping');
const { sendTeamsNotification } = require('./notificationService');

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
      const devices = await NetworkDevices.findAll();
      const offsetHours = process.env.DB_TIMEZONE_OFFSET !== undefined ? parseInt(process.env.DB_TIMEZONE_OFFSET) : 0;
      
      const batchSize = 10;
      console.log(`[PingLoop] Starting new cycle for ${devices.length} devices (Batch size: ${batchSize})`);

      for (let i = 0; i < devices.length; i += batchSize) {
        const batch = devices.slice(i, i + batchSize);
        const checkedAt = new Date(new Date().getTime() + offsetHours * 60 * 60 * 1000);
        
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
            // Using 3 packets (-n 3) and 5s timeout for high reliability
            const res = await ping.promise.probe(device.gateway, {
              timeout: 5,
              extra: ['-n', '3']
            });

            const newStatus = res.alive ? 'up' : 'down';
            
            // Detect status change and notify
            const prevStatus = statusMap[device.id];
            if (prevStatus && newStatus !== prevStatus) {
              // Notification is async, we don't await it here to avoid slowing down the loop
              sendTeamsNotification(device, newStatus, prevStatus);
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
          // Log results immediately for each batch
          await Promise.all([
            LatencyLogs.bulkCreate(batchResults),
            LatencyRecent.bulkCreate(batchResults),
            DeviceMetrics.bulkCreate(batchResults, {
              updateOnDuplicate: ['latency_ms', 'packet_loss', 'status', 'checked_at']
            })
          ]);
        }

        // Cleanup LatencyRecent for these devices: keep only last 130 mins (10 laps)
        const cleanupThreshold = new Date(checkedAt.getTime() - 130 * 60 * 1000);
        await LatencyRecent.destroy({
          where: {
            device_id: { [Op.in]: batch.map(d => d.id) },
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
