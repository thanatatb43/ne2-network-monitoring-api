const { runDailyAvailabilitySnapshot } = require('./src/services/aggregationService');

async function test() {
  console.log('--- Testing runDailyAvailabilitySnapshot ---');
  try {
    await runDailyAvailabilitySnapshot();
    console.log('--- Test Finished Successfully ---');
  } catch (err) {
    console.error('--- Test Failed ---');
    console.error(err);
  }
  process.exit(0);
}

test();
