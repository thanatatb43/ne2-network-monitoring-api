const { LatencyLogs, NetworkDevices } = require('./src/models');
const { runCleanupJob } = require('./src/services/cleanupService');

async function verifyCleanup() {
  console.log('--- VERIFYING CLEANUP LOGIC ---');

  try {
    // 1. Ensure we have a device for testing
    let device = await NetworkDevices.findOne();
    if (!device) {
      console.log('Creating test device...');
      device = await NetworkDevices.create({
        index: 999,
        pea_name: 'Test Device',
        gateway: '127.0.0.1'
      });
    }

    // 2. Insert an OLD record (2 days ago)
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    console.log(`Inserting old record for date: ${twoDaysAgo.toISOString()}`);
    
    await LatencyLogs.create({
      device_id: device.id,
      latency_ms: 10,
      packet_loss: 0,
      status: 'up',
      checked_at: twoDaysAgo
    });

    // 3. Insert a NEW record (1 hour ago)
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
    console.log(`Inserting new record for date: ${oneHourAgo.toISOString()}`);

    await LatencyLogs.create({
      device_id: device.id,
      latency_ms: 10,
      packet_loss: 0,
      status: 'up',
      checked_at: oneHourAgo
    });

    // 4. Run cleanup
    await runCleanupJob();

    // 5. Verify results
    const oldStillExists = await LatencyLogs.findOne({ where: { checked_at: twoDaysAgo } });
    const newStillExists = await LatencyLogs.findOne({ where: { checked_at: oneHourAgo } });

    if (!oldStillExists && newStillExists) {
      console.log('\nSUCCESS: Old record deleted, new record kept.');
    } else {
      console.log('\nFAILURE: Record matching logic failed.');
      console.log('Old exists:', !!oldStillExists);
      console.log('New exists:', !!newStillExists);
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    process.exit(0);
  }
}

verifyCleanup();
