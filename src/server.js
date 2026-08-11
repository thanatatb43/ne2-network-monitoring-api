require('dotenv').config();
const app = require('./app');
const port = process.env.PORT || 3000;

const cron = require('node-cron');
const { runPingJob, startContinuousPingLoop } = require('./services/pingService');
const { 
  runHourlyAggregation, 
  runDailyAvailabilitySnapshot, 
  updateDevicesAvailabilityDashboard 
} = require('./services/aggregationService');
const { runCleanupJob, runHourlyCleanupJob } = require('./services/cleanupService');
const { reconcileOrphanedDowntime } = require('./services/notificationService');
const db = require('./models');

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);

  // Start continuous monitoring loop (10 devices at a time)
  // This replaces the old cron-based ping job
  startContinuousPingLoop();

  // Close any downtime record left open from a previous process that was killed/restarted mid-flight
  console.log('[Server] Checking for stale open downtime records on startup...');
  reconcileOrphanedDowntime().catch(err => console.error('[Server] Startup downtime reconciliation failed:', err));

  // Catch up on missing snapshots on startup
  console.log('[Server] Checking for missing snapshots on startup...');
  runDailyAvailabilitySnapshot().catch(err => console.error('[Server] Startup snapshot catch-up failed:', err));

  // Schedule hourly tasks (Aggregation + Dashboard Update)
  cron.schedule('0 * * * *', async () => {
    console.log(`[Cron] Starting Hourly Aggregation at ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}`);
    await runHourlyAggregation();
    await runDailyAvailabilitySnapshot(); // Self-healing check for missed daily snapshots
    await updateDevicesAvailabilityDashboard();
    console.log(`[Cron] Hourly Aggregation Complete`);
  }, { timezone: 'Asia/Bangkok' });

  // 1:05 AM: Cleanup Minute logs older than 1 day
  cron.schedule('5 1 * * *', async () => {
    console.log(`[Cron] Starting Minute Cleanup Job (1:05 AM)`);
    await runCleanupJob();
    console.log(`[Cron] Minute Cleanup Job Complete`);
  }, { timezone: 'Asia/Bangkok' });

  // 2:05 AM: Cleanup Hourly logs older than 7 days
  cron.schedule('5 2 * * *', async () => {
    console.log(`[Cron] Starting Hourly Cleanup Job (2:05 AM)`);
    await runHourlyCleanupJob();
    console.log(`[Cron] Hourly Cleanup Job Complete`);
  }, { timezone: 'Asia/Bangkok' });

  // 3:05 AM: Create Daily Availability Snapshot
  cron.schedule('5 3 * * *', async () => {
    console.log(`[Cron] Starting Daily Snapshot Job (3:05 AM)`);
    await runDailyAvailabilitySnapshot();
    await updateDevicesAvailabilityDashboard();
    console.log(`[Cron] Daily Snapshot Job Complete`);
  }, { timezone: 'Asia/Bangkok' });

});
