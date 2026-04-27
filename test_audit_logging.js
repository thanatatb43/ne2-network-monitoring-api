const { NetworkDevices, DeviceAuditLog, User } = require('./src/models');
const jwt = require('jsonwebtoken');

async function test() {
  try {
    console.log('--- Testing Device Audit Logging ---');

    // 1. Get a test admin user and generate token
    const admin = await User.findOne({ where: { role: 'super_admin' } });
    if (!admin) {
        console.error('Super admin not found. Please run register first.');
        return;
    }
    const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, process.env.JWT_SECRET || 'secret');

    // 2. Perform Create
    console.log('\nTesting CREATE audit...');
    const createRes = await fetch('http://localhost:3000/api/devices/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        pea_name: 'Audit Test Device',
        gateway: '10.0.0.1'
      })
    });
    const created = await createRes.json();
    const deviceId = created.data.id;

    // Check log
    let log = await DeviceAuditLog.findOne({ where: { device_id: deviceId, action: 'CREATE' }, order: [['createdAt', 'DESC']] });
    if (log) {
      console.log('✅ CREATE log found:', { action: log.action, user: log.user_name, pea: log.pea_name });
    } else {
      console.error('❌ CREATE log NOT found');
    }

    // 3. Perform Update
    console.log('\nTesting UPDATE audit...');
    await fetch(`http://localhost:3000/api/devices/${deviceId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        gateway: '10.0.0.2'
      })
    });

    // Check log
    log = await DeviceAuditLog.findOne({ where: { device_id: deviceId, action: 'UPDATE' }, order: [['createdAt', 'DESC']] });
    if (log) {
      console.log('✅ UPDATE log found:', { action: log.action, user: log.user_name, data: log.data });
    } else {
      console.error('❌ UPDATE log NOT found');
    }

    // 4. Perform Delete
    console.log('\nTesting DELETE audit...');
    await fetch(`http://localhost:3000/api/devices/${deviceId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    // Check log
    log = await DeviceAuditLog.findOne({ where: { device_id: deviceId, action: 'DELETE' }, order: [['createdAt', 'DESC']] });
    if (log) {
      console.log('✅ DELETE log found (Device preserved in log):', { action: log.action, user: log.user_name, pea: log.pea_name });
      console.log('   Preserved data:', JSON.stringify(log.data).substring(0, 100) + '...');
    } else {
      console.error('❌ DELETE log NOT found');
    }

    console.log('\n--- Test Complete ---');
  } catch (error) {
    console.error('Test failed:', error);
  }
}

test();
