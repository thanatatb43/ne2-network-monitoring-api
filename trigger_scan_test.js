const { NetworkDevices, Clients, Sequelize } = require('./src/models');
const { scanNetworkAndSync } = require('./src/controllers/clientController');

// Mock req, res, next
const req = { params: { index: '129' } };
const res = {
  status: (code) => ({
    json: (data) => {
      console.log(`Response Code: ${code}`);
      console.log('Response Data:', JSON.stringify(data, null, 2));
    }
  })
};
const next = (err) => console.error('Next Error:', err);

async function testScan() {
  console.log('--- TRIGGERING MANUAL SCAN TEST (INDEX 129) ---');
  await scanNetworkAndSync(req, res, next);
  
  // Wait a moment for async operations to settle
  setTimeout(async () => {
    const clients = await Clients.findAll({ limit: 5 });
    console.log('\n--- VERIFYING CLIENTS IN DB ---');
    clients.forEach(c => {
      console.log(`Name: ${c.client_name} | MAC: ${c.mac_address} | IP: ${c.ip_address} | Status: ${c.status} | Time: ${c.last_online}`);
    });
    process.exit(0);
  }, 5000);
}

testScan();
