require('dotenv').config();
const { NetworkDevices, DeviceMetrics } = require('./src/models');
const { sendTeamsNotification } = require('./src/services/notificationService');
const ping = require('ping');

const testManualCheck = async (deviceId) => {
  console.log(`--- Testing Manual Check for Device ${deviceId} ---`);
  
  const device = await NetworkDevices.findByPk(deviceId);
  if (!device) return console.error('Device not found');

  // Check current status in DB
  const currentMetric = await DeviceMetrics.findOne({ where: { device_id: device.id } });
  const prevStatus = currentMetric ? currentMetric.status : 'unknown';
  console.log(`Current DB Status: ${prevStatus}`);

  // Simulate Ping
  console.log('Pinging...');
  const result = await ping.promise.probe(device.gateway, { timeout: 5, extra: ['-n', '3'] });
  const newStatus = result.alive ? 'up' : 'down';
  console.log(`New Status detected: ${newStatus}`);

  // Notification Logic (extracted from controller)
  if (prevStatus !== newStatus) {
    console.log(`Status changed from ${prevStatus} to ${newStatus}. Sending notification...`);
    await sendTeamsNotification(device, newStatus, prevStatus);
  } else {
    console.log('No status change detected. No notification sent.');
  }

  // Update DB
  await DeviceMetrics.upsert({
    device_id: device.id,
    status: newStatus,
    checked_at: new Date()
  });
  
  console.log('DB updated.');
};

testManualCheck(1);
