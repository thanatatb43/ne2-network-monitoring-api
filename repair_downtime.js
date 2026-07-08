const { NetworkDevices, LatencyLogs, DeviceDowntime, sequelize } = require('./src/models');
const { Op } = require('sequelize');

async function repairDowntime() {
  console.log('--- Starting Downtime History Repair (Last 7 Days) ---');
  
  // 1. Wipe existing downtime data to avoid duplicates during backfill
  console.log('Cleaning existing downtime records...');
  await DeviceDowntime.destroy({ where: {}, truncate: true });

  const devices = await NetworkDevices.findAll();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  console.log(`Analyzing logs since ${sevenDaysAgo.toLocaleString()} for ${devices.length} devices...`);

  for (const device of devices) {
    const logs = await LatencyLogs.findAll({
      where: {
        device_id: device.id,
        checked_at: { [Op.gte]: sevenDaysAgo }
      },
      order: [['checked_at', 'ASC']],
      raw: true
    });

    if (logs.length === 0) continue;

    let activeDowntime = null;
    let recordsToInsert = [];

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const nextLog = logs[i+1];

      if (log.status === 'down' && !activeDowntime) {
        // Start of a downtime period
        activeDowntime = {
          device_id: device.id,
          down_at: log.checked_at,
          status: 'down'
        };
      } 
      else if (log.status === 'up' && activeDowntime) {
        // End of a downtime period
        const up_at = log.checked_at;
        const down_at = new Date(activeDowntime.down_at);
        const duration_ms = up_at.getTime() - down_at.getTime();

        recordsToInsert.push({
          device_id: device.id,
          down_at: down_at,
          up_at: up_at,
          duration_ms: duration_ms,
          status: 'up',
          createdAt: new Date(),
          updatedAt: new Date()
        });

        activeDowntime = null;
      }
    }

    // Handle case where device is still down
    if (activeDowntime) {
      recordsToInsert.push({
        ...activeDowntime,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    if (recordsToInsert.length > 0) {
      await DeviceDowntime.bulkCreate(recordsToInsert);
      console.log(`[${device.pea_name}] Created ${recordsToInsert.length} downtime records.`);
    }
  }

  console.log('\n--- Downtime Repair Complete ---');
  process.exit(0);
}

repairDowntime().catch(err => {
  console.error('Repair failed:', err);
  process.exit(1);
});
