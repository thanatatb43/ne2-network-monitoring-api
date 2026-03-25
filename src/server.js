const app = require('./app');
const port = process.env.PORT || 3000;

const cron = require('node-cron');
const { runPingJob } = require('./services/pingService');
const { runHourlyAggregation } = require('./services/aggregationService');

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

  // Run ping job once immediately for verification
  runPingJob();
});
