const { LatencyLogs, Sequelize } = require('../models');
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

module.exports = {
  runCleanupJob
};
