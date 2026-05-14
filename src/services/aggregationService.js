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
 * Runs once per day (usually at 3:05 AM) and looks at the previous day's hourly data.
 * Improved to be self-healing: if run without targetDate, it checks for missing snapshots in the last 7 days.
 */
const runDailyAvailabilitySnapshot = async (targetDate = null) => {
  const datesToProcess = [];

  if (targetDate) {
    datesToProcess.push(targetDate);
  } else {
    // Self-healing: check last 7 days
    const today = new Date();
    const { NetworkDevices } = require('../models');
    const deviceCount = await NetworkDevices.count();
    
    console.log(`[SnapshotJob] Self-healing check: Expected ${deviceCount} devices per day.`);

    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      
      // Check if we have enough snapshots for this date
      const count = await DailyAvailabilitySnapshot.count({ where: { date: ds } });
      if (count < deviceCount) {
        console.log(`[SnapshotJob] Found missing/incomplete data for ${ds} (${count}/${deviceCount}). Adding to queue.`);
        datesToProcess.push(ds);
      }
    }
    
    // Always include yesterday to ensure it's refreshed with final data
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const ys = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    if (!datesToProcess.includes(ys)) {
      datesToProcess.push(ys);
    }
    
    // Sort dates ascending so we process oldest first
    datesToProcess.sort();
  }

  for (const dateString of datesToProcess) {
    const parts = dateString.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const day = parseInt(parts[2]);

    const startTime = new Date(year, month, day, 0, 0, 0);
    const endTime = new Date(year, month, day, 23, 59, 59, 999);

    console.log(`[SnapshotJob] Processing daily snapshot for ${dateString}...`);

    try {
      const aggregates = await LatencyHourly.findAll({
        attributes: [
          'device_id',
          [Sequelize.fn('AVG', Sequelize.col('packet_loss')), 'packet_loss'],
          [Sequelize.fn('AVG', Sequelize.col('avg_latency_ms')), 'avg_latency_ms']
        ],
        include: [{
          model: NetworkDevices,
          as: 'device',
          attributes: [],
          required: true
        }],
        where: {
          hour: {
            [Op.between]: [startTime, endTime]
          }
        },
        group: ['device_id'],
        raw: true
      });

      if (aggregates.length === 0) {
        console.log(`[SnapshotJob] No hourly data found for ${dateString}. Skipping.`);
        continue;
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

