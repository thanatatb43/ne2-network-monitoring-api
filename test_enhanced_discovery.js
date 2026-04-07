const scannerService = require('./src/services/scannerService');
const { Client, NetworkDevices } = require('./src/models');

async function testFullDiscovery() {
  console.log('--- STARTING ENHANCED DISCOVERY TEST ---');
  
  // 1. Pick a subnet. Let's use the first device's subnet if available, or a common local one.
  const devices = await NetworkDevices.findAll({ limit: 1 });
  if (devices.length === 0) {
    console.log('No devices found in DB to determine subnet.');
    process.exit(1);
  }
  
  const subnet = '172.21.5.0/24';
  
  console.log(`Scanning subnet: ${subnet}...`);
  
  // 2. Perform scan
  const results = await scannerService.scanSubnet(subnet);
  console.log(`Found ${results.length} active hosts.`);
  
  // 3. Print first 10 results to verify MAC and Name
  results.slice(0, 10).forEach(res => {
    console.log(`IP: ${res.ip_address} | MAC: ${res.mac_address || 'N/A'} | Name: ${res.client_name || 'N/A'}`);
  });
  
  // 4. Test Sync logic
  const withNames = results.filter(r => r.client_name && !r.client_name.startsWith('Device-'));
  const withMacs = results.filter(r => r.mac_address && !r.mac_address.startsWith('IP-'));
  
  console.log(`Summary: ${withNames.length} hosts with names, ${withMacs.length} hosts with MACs.`);
  
  if (results.length > 0) {
    console.log('SUCCESS: Discovery completed.');
  } else {
    console.log('WARNING: No hosts found. Check network connection.');
  }

  process.exit(0);
}

testFullDiscovery().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
