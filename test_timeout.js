const ping = require('ping');

async function testTimeout() {
  const target = '172.21.118.241';
  console.log(`Testing ping to ${target} with timeout: 1 (1s or 1ms?)...`);
  const res1 = await ping.promise.probe(target, { timeout: 1 });
  console.log('Result (timeout: 1):', res1.alive, res1.time);

  console.log(`Testing ping to ${target} with timeout: 10 (10s or 10ms?)...`);
  const res2 = await ping.promise.probe(target, { timeout: 10 });
  console.log('Result (timeout: 10):', res2.alive, res2.time);

  console.log(`Testing ping to ${target} with timeout: 1000 (1000s or 1000ms?)...`);
  const res3 = await ping.promise.probe(target, { timeout: 1000 });
  console.log('Result (timeout: 1000):', res3.alive, res3.time);
}

testTimeout();
