const { LatencyLogs, LatencyHourly, Sequelize } = require('../models');
const { Op } = Sequelize;

/**
 * Run hourly aggregation for all devices
 * Aggregates data from LatencyLogsMinutes (LatencyLogs model) 
 * for the previous full hour and inserts into LatencyLogsHourlies (LatencyHourly model).
 */
const runHourlyAggregation = async () => {
  const now = new Date();
  // Get the start of the previous hour
  const startOfPreviousHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 1, 0, 0);
  const endOfPreviousHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - 1, 59, 59, 999);

  console.log(`[AggregationJob] Starting for period: ${startOfPreviousHour.toISOString()} to ${endOfPreviousHour.toISOString()}`);

  try {
    const aggregates = await LatencyLogs.findAll({
      attributes: [
        'device_id',
        [Sequelize.fn('AVG', Sequelize.col('latency_ms')), 'avg_latency_ms'],
        [Sequelize.fn('MIN', Sequelize.col('latency_ms')), 'min_latency_ms'],
        [Sequelize.fn('MAX', Sequelize.col('latency_ms')), 'max_latency_ms'],
        [Sequelize.fn('AVG', Sequelize.col('packet_loss')), 'packet_loss'],
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'samples'],
      ],
      where: {
        checked_at: {
          [Op.between]: [startOfPreviousHour, endOfPreviousHour]
        }
      },
      group: ['device_id'],
      raw: true
    });

    if (aggregates.length === 0) {
      console.log('[AggregationJob] No data found for the previous hour.');
      return;
    }

    const hourlyRecords = aggregates.map(agg => ({
      device_id: agg.device_id,
      avg_latency_ms: agg.avg_latency_ms,
      min_latency_ms: agg.min_latency_ms,
      max_latency_ms: agg.max_latency_ms,
      packet_loss: agg.packet_loss,
      samples: agg.samples,
      hour: startOfPreviousHour
    }));

    // Use bulkCreate with updateOnDuplicate if the unique constraint (device_id, hour) is violated
    await LatencyHourly.bulkCreate(hourlyRecords, {
      updateOnDuplicate: ['avg_latency_ms', 'min_latency_ms', 'max_latency_ms', 'packet_loss', 'samples']
    });

    console.log(`[AggregationJob] Successfully aggregated data for ${hourlyRecords.length} devices.`);
  } catch (error) {
    console.error('[AggregationJob] Aggregation failed:', error);
  }
};

module.exports = {
  runHourlyAggregation
};
