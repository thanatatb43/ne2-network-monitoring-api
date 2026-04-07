const { scanSubnet } = require('./src/services/scannerService');

async function test() {
  console.log('Scanning 172.21.118.241/32 (just the IP)...');
  const res1 = await scanSubnet('172.21.118.241', '/32');
  console.log('Results /32:', JSON.stringify(res1, null, 2));

  console.log('Scanning 172.21.118.240/30 (4 IPs)...');
  const res2 = await scanSubnet('172.21.118.240', '/30');
  console.log('Results /30:', JSON.stringify(res2, null, 2));
}

test();
