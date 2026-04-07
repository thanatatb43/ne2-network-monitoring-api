const app = require('./app');
const port = process.env.PORT || 3000;

const cron = require('node-cron');
const { runPingJob } = require('./services/pingService');
const { runHourlyAggregation } = require('./services/aggregationService');
const { runCleanupJob } = require('./services/cleanupService');
const db = require('./models');

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);

  // Schedule minute-level ping job
  cron.schedule('* * * * *', () => {
    runPingJob();
  });

  // Schedule hourly aggregation job at the start of every hour
  cron.schedule('0 * * * *', () => {
    runHourlyAggregation();
  });

  // Schedule daily cleanup job at 9:00 AM
  cron.schedule('0 9 * * *', () => {
    runCleanupJob();
  });

  // Run ping job once immediately for verification
  runPingJob();
});
