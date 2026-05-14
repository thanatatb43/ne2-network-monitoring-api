const { runDailyAvailabilitySnapshot, updateDevicesAvailabilityDashboard } = require('./src/services/aggregationService');
const db = require('./src/models');

async function repair() {
  console.log('--- Starting Daily Availability Snapshot Repair ---');
  
  // Dates to repair: May 1st to May 7th
  const dates = [
    '2026-05-01',
    '2026-05-02',
    '2026-05-03',
    '2026-05-04',
    '2026-05-05',
    '2026-05-06',
    '2026-05-07'
  ];

  for (const date of dates) {
    console.log(`\nRepairing snapshots for: ${date}`);
    // runDailyAvailabilitySnapshot expects a date object or null (for yesterday)
    // If we pass a string, it will be parsed by new Date(targetDate)
    await runDailyAvailabilitySnapshot(date);
  }

  console.log('\n--- Refreshing Dashboard ---');
  await updateDevicesAvailabilityDashboard();
  
  console.log('\nRepair Complete.');
  process.exit(0);
}

repair().catch(err => {
  console.error('Repair failed:', err);
  process.exit(1);
});
