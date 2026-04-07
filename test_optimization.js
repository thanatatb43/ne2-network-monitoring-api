const { scanSubnet } = require('./src/services/scannerService');

async function test(batchSize) {
  // We'll temporarily modify the service to use the passed batchSize
  // But for this test, we'll just run a partial scan manually to check reliability
  console.log(`Testing scan with batch size ${batchSize}...`);
  // ... (manual implementation of scanSubnet for testing)
}

// Actually, I'll just temporarily update scannerService.js and run test_full_scan.js
