const ping = require('ping');

async function testConcurrency() {
  const target = '172.21.118.241';
  const concurrency = 100;
  console.log(`Starting ${concurrency} concurrent pings to ${target}...`);
  
  const startTime = Date.now();
  const promises = [];
  for (let i = 0; i < concurrency; i++) {
    promises.push(ping.promise.probe(target, { timeout: 2 }));
  }
  
  const results = await Promise.all(promises);
  const duration = Date.now() - startTime;
  
  const successCount = results.filter(r => r.alive).length;
  console.log(`Finished ${concurrency} pings in ${duration}ms. Success: ${successCount}/${concurrency}`);
}

testConcurrency();
