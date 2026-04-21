const { LatencyLogs, LatencyHourly, DailyAvailabilitySnapshot, DevicesAvailability, NetworkDevices, Sequelize } = require('../models');
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

/**

 * Creates a daily summary of uptime for all devices.
 * Runs once per day (usually at 3:00 AM) and looks at the previous day's hourly data.
 */
const runDailyAvailabilitySnapshot = async (targetDate = null) => {
  const yesterday = targetDate ? new Date(targetDate) : new Date();
  if (!targetDate) yesterday.setDate(yesterday.getDate() - 1);
  
  // Use local components for the date string to avoid UTC shifting issues
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, '0');
  const day = String(yesterday.getDate()).padStart(2, '0');
  const dateString = `${year}-${month}-${day}`;

  const startTime = new Date(year, yesterday.getMonth(), yesterday.getDate(), 0, 0, 0);
  const endTime = new Date(year, yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);


  console.log(`[SnapshotJob] Creating daily snapshot for ${dateString}...`);

  try {
    const aggregates = await LatencyHourly.findAll({
      attributes: [
        'device_id',
        [Sequelize.fn('AVG', Sequelize.col('packet_loss')), 'packet_loss'],
        [Sequelize.fn('AVG', Sequelize.col('avg_latency_ms')), 'avg_latency_ms']
      ],
      where: {
        hour: {
          [Op.between]: [startTime, endTime]
        }
      },
      group: ['device_id'],
      raw: true
    });

    if (aggregates.length === 0) {
      console.log(`[SnapshotJob] No hourly data found for ${dateString}.`);
      return;
    }

    const snapshotRecords = aggregates.map(agg => ({
      device_id: agg.device_id,
      date: dateString,
      uptime_pct: Math.max(0, 100 - (agg.packet_loss || 0)),
      avg_latency_ms: agg.avg_latency_ms || 0
    }));

    await DailyAvailabilitySnapshot.bulkCreate(snapshotRecords, {
      updateOnDuplicate: ['uptime_pct', 'avg_latency_ms']
    });

    console.log(`[SnapshotJob] Successfully saved ${snapshotRecords.length} snapshots for ${dateString}.`);
  } catch (error) {
    console.error(`[SnapshotJob] Failed for ${dateString}:`, error);
  }
};

/**
 * Updates the DevicesAvailability dashboard table with rolling window calculations.
 * Runs hourly after the hourly aggregation.
 */
const updateDevicesAvailabilityDashboard = async () => {
  console.log('[AvailabilityJob] Refreshing availability dashboard...');

  try {
    const devices = await NetworkDevices.findAll({ attributes: ['id'] });
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    for (const device of devices) {
      const deviceId = device.id;

      // 1. Daily Availability (from last 24h of hourly logs)
      const dailyResult = await LatencyHourly.findOne({
        attributes: [[Sequelize.fn('AVG', Sequelize.col('packet_loss')), 'packet_loss']],
        where: {
          device_id: deviceId,
          hour: { [Op.gte]: oneDayAgo }
        },
        raw: true
      });
      const daily_ava = dailyResult ? Math.max(0, 100 - (dailyResult.packet_loss || 0)) : 0;

      // 2. Weekly/Monthly/Yearly (from DailyAvailabilitySnapshot history)
      const getHistoryAva = async (days) => {
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - days);
        const result = await DailyAvailabilitySnapshot.findOne({
          attributes: [[Sequelize.fn('AVG', Sequelize.col('uptime_pct')), 'avg_uptime']],
          where: {
            device_id: deviceId,
            date: { [Op.gt]: thresholdDate.toISOString().split('T')[0] }
          },
          raw: true
        });
        return result ? (result.avg_uptime || 0) : 0;
      };

      const weekly_ava = await getHistoryAva(7);
      const monthly_ava = await getHistoryAva(30);
      const yearly_ava = await getHistoryAva(365);

      await DevicesAvailability.upsert({
        device_id: deviceId,
        daily_ava,
        weekly_ava,
        monthly_ava,
        yearly_ava
      });
    }

    console.log(`[AvailabilityJob] Dashboard updated for ${devices.length} devices.`);
  } catch (error) {
    console.error('[AvailabilityJob] Refresh failed:', error);
  }
};

module.exports = {
  runHourlyAggregation,
  runDailyAvailabilitySnapshot,
  updateDevicesAvailabilityDashboard
};

