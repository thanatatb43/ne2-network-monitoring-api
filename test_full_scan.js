const { scanSubnet } = require('./src/services/scannerService');

async function test() {
  console.log('Scanning 172.21.118.0/24 (254 IPs)...');
  const results = await scanSubnet('172.21.118.0', '/24');
  console.log('Found responsive:', results.length);
  console.log('Sample results:', JSON.stringify(results.slice(0, 5), null, 2));
  const me = results.find(r => r.ip_address === '172.21.118.241');
  console.log('Found myself (172.21.118.241):', !!me);
}

test();
