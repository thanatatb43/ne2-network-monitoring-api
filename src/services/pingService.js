const { NetworkDevices, LatencyLogs, LatencyRecent, DeviceMetrics, Sequelize } = require('../models');
const { Op } = Sequelize;
const ping = require('ping');

/**
 * Service to ping all network devices and log results
 */
const runPingJob = async () => {
  console.log(`[PingJob] Started at ${new Date().toISOString()}`);

  try {
    const devices = await NetworkDevices.findAll();
    const offsetHours = process.env.DB_TIMEZONE_OFFSET !== undefined ? parseInt(process.env.DB_TIMEZONE_OFFSET) : 0;
    const checkedAt = new Date(new Date().getTime() + offsetHours * 60 * 60 * 1000);

    const results = [];
    const batchSize = 20;

    for (let i = 0; i < devices.length; i += batchSize) {
      const batch = devices.slice(i, i + batchSize);
      const batchPromises = batch.map(async (device) => {
        // If a device doesn't have a gateway, we can't ping it.
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
          const res = await ping.promise.probe(device.gateway, {
            timeout: 2, // 2 seconds timeout
          });

          return {
            device_id: device.id,
            latency_ms: res.alive ? parseFloat(res.avg) : null,
            packet_loss: res.packetLoss ? parseFloat(res.packetLoss) : 0,
            status: res.alive ? 'up' : 'down',
            checked_at: checkedAt
          };
        } catch (err) {
          console.error(`[PingJob] Error pinging ${device.gateway}:`, err);
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
      results.push(...batchResults.filter(r => r !== null));
    }

    if (results.length > 0) {
      // Log to all relevant tables
      await Promise.all([
        LatencyLogs.bulkCreate(results),
        LatencyRecent.bulkCreate(results),
        // Use upsert for DeviceMetrics to keep only the latest record per device
        DeviceMetrics.bulkCreate(results, {
          updateOnDuplicate: ['latency_ms', 'packet_loss', 'status', 'checked_at']
        })
      ]);

      // Cleanup LatencyRecent: delete records older than 10 minutes
      const tenMinutesAgo = new Date(checkedAt.getTime() - 10 * 60 * 1000);
      const deletedCount = await LatencyRecent.destroy({
        where: {
          checked_at: {
            [Op.lt]: tenMinutesAgo
          }
        }
      });

      console.log(`[PingJob] Logged ${results.length} results to multiple tables. Cleaned up ${deletedCount} old records from LatencyRecents.`);
    }
  } catch (error) {
    console.error('[PingJob] Job failed:', error);
  }
};

module.exports = {
  runPingJob
};
