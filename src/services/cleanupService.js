const { LatencyLogs, LatencyHourly, Sequelize } = require('../models');
const { Op } = Sequelize;

/**
 * Cleanup job to delete records older than 1 day in LatencyLogsMinutes
 */
const runCleanupJob = async () => {
  console.log('[CleanupService] Starting daily cleanup for LatencyLogsMinutes...');
  
  try {
    // 24 hours ago
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const deletedCount = await LatencyLogs.destroy({
      where: {
        checked_at: {
          [Op.lt]: oneDayAgo
        }
      }
    });

    console.log(`[CleanupService] Successfully deleted ${deletedCount} records older than ${oneDayAgo.toISOString()}`);
  } catch (error) {
    console.error('[CleanupService] Cleanup job failed:', error);
  }
};

/**
 * Cleanup job to delete records older than 7 days in LatencyLogsHourlies
 */
const runHourlyCleanupJob = async () => {
  console.log('[CleanupService] Starting weekly cleanup for LatencyLogsHourlies...');
  
  try {
    // 7 days ago
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const deletedCount = await LatencyHourly.destroy({
      where: {
        hour: {
          [Op.lt]: sevenDaysAgo
        }
      }
    });

    console.log(`[CleanupService] Successfully deleted ${deletedCount} hourly records older than ${sevenDaysAgo.toISOString()}`);
  } catch (error) {
    console.error('[CleanupService] Hourly cleanup job failed:', error);
  }
};

module.exports = {
  runCleanupJob,
  runHourlyCleanupJob
};

