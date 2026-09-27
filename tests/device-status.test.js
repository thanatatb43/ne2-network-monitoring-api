'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { echoLossPercent } = require('../src/services/deviceProbe');
const { describeLiveStatus, liveStatusMeta, staleAfterSeconds } = require('../src/services/deviceLiveStatus');

const withEnv = (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return fn(); } finally {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

test('packet loss counts real echo replies, not Windows\' summary line', () => {
  assert.equal(echoLossPercent({ alive: true, times: [39, 39, 39], packetLoss: '0.000' }), 0);
  assert.equal(echoLossPercent({ alive: true, times: [39], packetLoss: '66.667' }), 66.67);
  // 2 real replies + 1 "Destination host unreachable" from a router: Windows says 0%.
  assert.equal(echoLossPercent({ alive: true, times: [40, 41], packetLoss: '0.000' }), 33.33);
  // No real reply, router answered "unreachable" once: Windows says 33%, truth is 100%.
  assert.equal(echoLossPercent({ alive: false, packetLoss: '33.000' }), 100);
  assert.equal(echoLossPercent({ alive: false }), 100);
  assert.equal(echoLossPercent(undefined), 100);
  assert.equal(echoLossPercent({ alive: true, times: [5] }, 2), 50);
});

const NOW = Date.parse('2026-09-27T08:00:00.000Z');
const ago = (seconds) => new Date(NOW - seconds * 1000).toISOString();

test('fresh results keep their status; live_status and alive agree', () => {
  withEnv({ DEVICE_STATUS_STALE_SECONDS: undefined, DB_TIMEZONE_OFFSET: '0' }, () => {
    assert.deepEqual(describeLiveStatus({ status: 'up', checked_at: ago(60) }, NOW),
      { live_status: 'up', alive: true, stale: false, age_seconds: 60 });
    assert.deepEqual(describeLiveStatus({ status: 'down', checked_at: ago(600) }, NOW),
      { live_status: 'down', alive: false, stale: false, age_seconds: 600 });
  });
});

test('a result older than the threshold is unknown, never shown as current', () => {
  withEnv({ DEVICE_STATUS_STALE_SECONDS: undefined, DB_TIMEZONE_OFFSET: '0' }, () => {
    assert.equal(staleAfterSeconds(), 45 * 60);
    // exactly at the threshold still counts; one second past does not
    assert.equal(describeLiveStatus({ status: 'up', checked_at: ago(2700) }, NOW).live_status, 'up');
    const stale = describeLiveStatus({ status: 'down', checked_at: ago(2701) }, NOW);
    assert.deepEqual(stale, { live_status: 'unknown', alive: null, stale: true, age_seconds: 2701 });
    // the 5-month-old row found in production
    assert.equal(describeLiveStatus({ status: 'down', checked_at: '2026-04-24T07:05:01.000Z' }, NOW).live_status, 'unknown');
  });
});

test('missing or unrecognised data is unknown', () => {
  withEnv({ DB_TIMEZONE_OFFSET: '0' }, () => {
    assert.equal(describeLiveStatus(null, NOW).live_status, 'unknown');
    assert.equal(describeLiveStatus({ status: 'up', checked_at: null }, NOW).live_status, 'unknown');
    assert.equal(describeLiveStatus({ status: 'up', checked_at: 'not a date' }, NOW).live_status, 'unknown');
    const odd = describeLiveStatus({ status: 'maintenance', checked_at: ago(10) }, NOW);
    assert.equal(odd.live_status, 'unknown');
    assert.equal(odd.alive, null);
    assert.equal(odd.stale, false, 'fresh but unrecognised is not the same as stale');
  });
});

test('threshold is configurable and the stored timezone offset is honoured', () => {
  withEnv({ DEVICE_STATUS_STALE_SECONDS: '120', DB_TIMEZONE_OFFSET: '0' }, () => {
    assert.equal(describeLiveStatus({ status: 'up', checked_at: ago(121) }, NOW).live_status, 'unknown');
    assert.equal(liveStatusMeta().stale_after_seconds, 120);
  });
  // The loop stores checked_at shifted by DB_TIMEZONE_OFFSET hours; a just-measured row
  // must not look 7 hours old (or 7 hours in the future) because of it.
  withEnv({ DEVICE_STATUS_STALE_SECONDS: undefined, DB_TIMEZONE_OFFSET: '7' }, () => {
    const storedNow = new Date(NOW + 7 * 3600 * 1000 - 30 * 1000).toISOString();
    assert.deepEqual(describeLiveStatus({ status: 'up', checked_at: storedNow }, NOW),
      { live_status: 'up', alive: true, stale: false, age_seconds: 30 });
  });
  withEnv({ DEVICE_STATUS_STALE_SECONDS: 'garbage' }, () => assert.equal(staleAfterSeconds(), 2700));
});

test('meta publishes the precedence order', () => {
  assert.deepEqual(liveStatusMeta().status_precedence, ['live_status', 'alive', 'status']);
});
