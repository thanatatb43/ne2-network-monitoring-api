const { getNbtStatInfo, scanSubnet } = require('./src/services/scannerService');

async function verifyDiscovery() {
  console.log('--- VERIFYING ENHANCED DISCOVERY ---');
  
  const targetIp = '172.21.5.2'; // Known IP from user's machine
  console.log(`Testing NBTSTAT on ${targetIp}...`);
  
  const nbt = await getNbtStatInfo(targetIp);
  console.log('NBTSTAT Results:', JSON.stringify(nbt, null, 2));

  console.log('\nTesting Small Subnet Scan (172.21.5.0/30)...');
  try {
    const results = await scanSubnet('172.21.5.0', '/30');
    console.log('Scan Results count:', results.length);
    results.forEach(r => {
      console.log(`IP: ${r.ip_address} | Name: ${r.client_name} | MAC: ${r.mac_address}`);
    });
  } catch (e) {
    console.error('Scan failed:', e);
  }
}

verifyDiscovery();
