const { runDailyAvailabilitySnapshot } = require('./src/services/aggregationService');

async function fixSnapshots() {
  const dates = ['2026-04-24', '2026-04-25', '2026-04-26'];
  for (const date of dates) {
    console.log(`Manually running snapshot for ${date}...`);
    await runDailyAvailabilitySnapshot(date);
  }
  process.exit();
}

fixSnapshots();
