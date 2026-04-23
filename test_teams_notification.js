require('dotenv').config();
const { sendTeamsNotification } = require('./src/services/notificationService');

const testNotification = async () => {
  console.log('--- Testing Microsoft Teams Notification ---');
  
  const mockDevice = {
    pea_name: 'TEST-DEVICE-01',
    gateway: '192.168.1.1',
    province: 'Bangkok'
  };

  console.log('Sending DOWN notification...');
  await sendTeamsNotification(mockDevice, 'down', 'up');
  
  console.log('\nWaiting 2 seconds...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('Sending UP notification...');
  await sendTeamsNotification(mockDevice, 'up', 'down');

  console.log('\nTest complete. Check your Microsoft Teams channel.');
};

testNotification();
