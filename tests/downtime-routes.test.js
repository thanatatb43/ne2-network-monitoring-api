'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('HTTP routes keep legacy handlers, dispatch v2 and keep new static paths public', async t => {
  const legacyPath = require.resolve('../src/controllers/networkDeviceController');
  const v2Path = require.resolve('../src/controllers/downtimeHistoryController');
  const authPath = require.resolve('../src/middleware/authMiddleware');
  const routerPath = require.resolve('../src/routes/networkDeviceRoutes');
  const saved = [legacyPath, v2Path, authPath, routerPath].map(path => [path, require.cache[path]]);
  const reply = name => (req, res) => res.json({ handler: name, id: req.params.id });
  const legacy = Object.fromEntries(['getAllDevices', 'getDowntimeSummary', 'getDevicesDowntimeSummary', 'getAllDowntimeRecords',
    'getDowntimeDashboard', 'getDeviceById', 'getDeviceDowntimeHistory', 'createDevice', 'updateDevice', 'deleteDevice'].map(name => [name, reply(name)]));
  require.cache[legacyPath] = { id: legacyPath, filename: legacyPath, loaded: true, exports: legacy };
  require.cache[v2Path] = { id: v2Path, filename: v2Path, loaded: true,
    exports: Object.fromEntries(['incidents', 'selectors', 'summary', 'dashboard'].map(name => [name, reply(`v2:${name}`)])) };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true,
    exports: { verifyToken: (req, res) => res.sendStatus(401), hasRole: () => (req, res, next) => next() } };
  delete require.cache[routerPath];
  const app = express();
  app.use('/api/devices', require(routerPath));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
  });
  const root = `http://127.0.0.1:${server.address().port}/api/devices`;
  for (const [path, expected] of [
    ['/downtime/summary', 'getDowntimeSummary'], ['/downtime/dashboard?year=2026', 'getDowntimeDashboard'],
    ['/downtime/all', 'getAllDowntimeRecords'], ['/downtime/devices', 'getDevicesDowntimeSummary'],
    ['/123/downtime', 'getDeviceDowntimeHistory'], ['/123', 'getDeviceById'],
    ['/downtime/incidents', 'v2:incidents'], ['/downtime/selectors', 'v2:selectors'],
    ['/downtime/summary?contract=v2', 'v2:summary'], ['/downtime/dashboard?contract=v2', 'v2:dashboard'],
    ['/downtime/summary?contract=bad', 'v2:summary']
  ]) {
    const response = await fetch(root + path);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).handler, expected);
  }
  assert.equal((await fetch(root, { method: 'POST' })).status, 401);
});
