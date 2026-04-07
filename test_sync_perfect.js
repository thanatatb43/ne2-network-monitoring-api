const { LatencyRecent } = require('./src/models');

async function testSync() {
  console.log('--- TESTING PERFECT TIME SYNC ---');
  console.log('Node current time:', new Date().toLocaleString());
  
  // Create a record
  const startTime = new Date();
  const testRecord = await LatencyRecent.create({
    device_id: 1, // Using a dummy/existing ID
    latency_ms: 999,
    status: 'online',
    checked_at: startTime
  });
  
  console.log('Record created with checked_at (Node):', startTime.toLocaleString());
  console.log('Record value in DB (Instance):', testRecord.checked_at.toLocaleString());
  
  // Fetch it back
  const fetched = await LatencyRecent.findByPk(testRecord.id);
  console.log('Fetched record checked_at:', fetched.checked_at.toLocaleString());
  
  const diffMinutes = Math.abs(fetched.checked_at - startTime) / (1000 * 60);
  console.log('Difference (minutes):', diffMinutes);
  
  if (diffMinutes < 1) {
    console.log('SUCCESS: Time matches perfectly!');
  } else {
    console.log('FAILURE: Time mismatch persists.');
  }
  
  // Delete test record
  await testRecord.destroy();
  process.exit(0);
}

testSync().catch(e => {
  console.error(e);
  process.exit(1);
});
