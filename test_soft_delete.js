const { NetworkDevices, User, sequelize } = require('./src/models');
const jwt = require('jsonwebtoken');

async function test() {
  try {
    console.log('--- Testing Soft-Delete (Paranoid Mode) ---');

    // 1. Get a test admin user and generate token
    const admin = await User.findOne({ where: { role: 'super_admin' } });
    const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, process.env.JWT_SECRET || 'secret');

    // 2. Create a device
    console.log('\nCreating a test device...');
    const device = await NetworkDevices.create({ pea_name: 'Soft Delete Test', gateway: '10.99.99.99' });
    const deviceId = device.id;

    // 3. Create a dependency in Clients table
    // We'll use raw query to avoid needing the Client model details if not fully known
    console.log('Creating a client dependency...');
    await sequelize.query(`INSERT INTO clients (client_name, main_site_id, first_seen, last_online, createdAt, updatedAt) VALUES ('Test Client', ${deviceId}, NOW(), NOW(), NOW(), NOW())`);

    // 4. Try to delete the device via API
    console.log(`\nAttempting to delete device ${deviceId} via API...`);
    const deleteRes = await fetch(`http://localhost:3000/api/devices/${deviceId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    const result = await deleteRes.json();
    console.log('API Response:', result);

    if (result.success) {
      console.log('✅ Success: API reported successful deletion (soft-delete).');
    } else {
      console.error('❌ Failure: API reported error:', result.message);
    }

    // 5. Verify it still exists in DB but is "hidden"
    console.log('\nVerifying database state...');
    const active = await NetworkDevices.findByPk(deviceId);
    console.log('Active check (findByPk):', active ? 'Found (Fail)' : 'Not Found (Pass)');

    const raw = await sequelize.query(`SELECT id, pea_name, deletedAt FROM network_devices WHERE id = ${deviceId}`, { type: sequelize.QueryTypes.SELECT });
    console.log('Raw DB check:', raw[0]);

    if (raw[0] && raw[0].deletedAt) {
      console.log('✅ Success: Device still exists in DB but has deletedAt set.');
    } else {
      console.error('❌ Failure: Device was either hard deleted or deletedAt not set.');
    }

    // 6. Cleanup
    console.log('\nCleaning up...');
    await sequelize.query(`DELETE FROM clients WHERE main_site_id = ${deviceId}`);
    await sequelize.query(`DELETE FROM network_devices WHERE id = ${deviceId}`); // Hard delete for cleanup

    console.log('--- Test Complete ---');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

test();
