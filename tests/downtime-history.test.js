'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Sequelize, DataTypes } = require('sequelize');
const { createService } = require('../src/services/downtimeHistoryService');
const { parseQuery, normalize, safeNumber } = require('../src/services/downtimeContract');
const migration = require('../database/migrations/20260924100000-create-downtime-query-snapshots');
const base = { date_from: '2026-01-01T00:00:00+07:00', date_to_exclusive: '2026-01-02T00:00:00+07:00' };
const asOf = Date.parse('2026-01-02T12:00:00+07:00');
const hour = 3600000;

async function setup(t, { records, time = asOf, logging = false } = {}) {
  const sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging });
  const NetworkDevices = sequelize.define('NetworkDevices', {
    pea_name: DataTypes.STRING, gateway: DataTypes.STRING, province: DataTypes.STRING
  }, { tableName: 'network_devices', paranoid: true });
  const DeviceDowntime = require('../src/models/devicedowntime')(sequelize, DataTypes);
  const Snapshot = require('../src/models/downtimequerysnapshot')(sequelize, DataTypes);
  const Row = require('../src/models/downtimequeryrow')(sequelize, DataTypes);
  DeviceDowntime.associate({ NetworkDevices });
  await NetworkDevices.sync();
  await DeviceDowntime.sync();
  await migration.up(sequelize.getQueryInterface(), Sequelize);
  t.after(() => sequelize.close());
  await NetworkDevices.bulkCreate([
    { id: 1, pea_name: 'สำนักงานอุบล TEST %_\\', province: 'อุบลราชธานี', gateway: '172.21.1.1' },
    { id: 2, pea_name: 'สำนักงานยโสธร', province: 'ยโสธร', gateway: '172.21.2.1' },
    { id: 3, pea_name: 'สำนักงานเก่า', province: 'อุบลราชธานี', gateway: null }
  ]);
  await DeviceDowntime.bulkCreate(records || [
    { id: 1, device_id: 1, down_at: '2025-12-31T23:00:00+07:00', up_at: '2026-01-01T01:00:00+07:00', status: 'up' },
    { id: 2, device_id: 1, down_at: '2026-01-01T12:00:00+07:00', up_at: '2026-01-01T14:00:00+07:00', status: 'up' },
    { id: 3, device_id: 2, down_at: '2026-01-01T23:00:00+07:00', up_at: null, status: 'down' }
  ]);
  let clock = time;
  const models = { sequelize, NetworkDevices, DeviceDowntime, DowntimeQuerySnapshot: Snapshot, DowntimeQueryRow: Row };
  return { ...models, service: createService(models, { now: () => clock }), advance: ms => { clock += ms; } };
}

test('spec fixture: shared totals, numeric durations and drill-down agree', async t => {
  const { service } = await setup(t);
  const summary = await service.execute('summary', { ...base, contract: 'v2' });
  assert.equal(summary.data.matched_incident_count, 3);
  assert.equal(summary.data.started_incident_count, 2);
  assert.equal(summary.data.total_duration_in_range_ms, 14400000);
  assert.equal(summary.data.affected_device_count, 2);
  assert.equal(summary.data.current_state.currently_offline_device_count, 1);
  assert.equal(summary.data.current_state.observed_at, null);
  const query = { ...base, snapshot_token: summary.meta.snapshot_token };
  const list = await service.execute('incidents', query);
  assert.equal(list.data.pagination.total_items, 3);
  assert.equal(list.data.items.find(item => item.incident_id === '3').duration_ms, 46800000);
  assert.equal(list.data.items[0].device_id, '2');
  const graph = await service.execute('dashboard', query);
  for (const buckets of [graph.data.daily, graph.data.monthly]) {
    assert.equal(buckets.reduce((sum, row) => sum + (row.started_incident_count || 0), 0), 2);
    assert.equal(buckets.reduce((sum, row) => sum + (row.duration_in_range_ms || 0), 0), 14400000);
  }
  assert.equal(graph.data.top_devices[0].device_id, '1');
  const drill = await service.execute('incidents', { ...query, match: 'started' });
  assert.equal(drill.data.pagination.total_items, 2);
  assert.equal(graph.data.daily[0].period_start, '2026-01-01T00:00:00.000+07:00');
});

test('all filters operate before pagination, and substring wildcard characters stay literal', async t => {
  const { service } = await setup(t);
  const first = await service.execute('summary', base);
  const query = { ...base, snapshot_token: first.meta.snapshot_token };
  for (const filter of [{ q: 'not-found-xyz' }, { province: 'missing' }, { device_id: '999' }, { status: 'unknown' }]) {
    assert.equal((await service.execute('incidents', { ...query, ...filter })).data.pagination.total_items, 0);
    assert.equal((await service.execute('summary', { ...query, ...filter })).data.matched_incident_count, 0);
    assert.equal((await service.execute('dashboard', { ...query, ...filter })).data.totals.matched_incident_count, 0);
  }
  for (const q of ['อุบล', 'test', '%_\\', '172.21.1.1']) {
    const result = await service.execute('incidents', { ...query, q, page_size: '1', page: '2' });
    assert.equal(result.data.pagination.total_items, 2);
    assert.equal(result.data.items.length, 1);
  }
  const filtered = await service.execute('summary', { ...query, q: 'อุบล', province: 'อุบลราชธานี', device_id: '1', status: 'resolved' });
  assert.equal(filtered.data.matched_incident_count, 2);
  assert.equal(filtered.data.current_state.currently_offline_device_count, 1);
  const emptyPage = await service.execute('incidents', { ...query, page: '999' });
  assert.deepEqual(emptyPage.data.items, []);
  assert.equal(emptyPage.data.pagination.page, 999);
  assert.equal(emptyPage.data.pagination.total_items, 3);
});

test('snapshot freezes updates, inserts and device metadata; expires and rejects other scopes', async t => {
  const env = await setup(t);
  const { service, DeviceDowntime, NetworkDevices } = env;
  const first = await service.execute('incidents', { ...base, page_size: '1' });
  const query = { ...base, snapshot_token: first.meta.snapshot_token };
  await DeviceDowntime.update({ status: 'up', up_at: '2026-01-02T01:00:00+07:00' }, { where: { id: 3 } });
  await DeviceDowntime.create({ device_id: 2, status: 'down', down_at: '2026-01-01T22:00:00+07:00' });
  await NetworkDevices.update({ pea_name: 'changed' }, { where: { id: 2 } });
  const frozen = await service.execute('incidents', query);
  assert.equal(frozen.data.pagination.total_items, 3);
  assert.equal(frozen.data.items[0].status, 'open');
  assert.equal(frozen.data.items[0].pea_name, 'สำนักงานยโสธร');
  const fresh = await service.execute('incidents', base);
  assert.equal(fresh.data.pagination.total_items, 4);
  assert.equal(fresh.data.items.find(item => item.incident_id === '3').status, 'resolved');
  assert.notEqual(fresh.meta.snapshot_token, first.meta.snapshot_token);
  await assert.rejects(service.execute('summary', query, 'another-scope'), { code: 'INVALID_SNAPSHOT' });
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const result = await service.execute('incidents', { ...query, page: String(page), page_size: '1' });
    ids.push(result.data.items[0].incident_id);
  }
  assert.equal(new Set(ids).size, 3);
  env.advance(600001);
  await assert.rejects(service.execute('summary', query), { code: 'SNAPSHOT_EXPIRED', status: 410 });
  await service.execute('summary', base);
  assert.equal(await env.DowntimeQueryRow.count({ where: { snapshot_token: query.snapshot_token } }), 0);
});

test('boundaries, unknown intervals, null-last sorting and soft-deleted devices', async t => {
  const { service, NetworkDevices } = await setup(t, { records: [
    { id: 2, device_id: 1, down_at: '2025-12-31T23:00:00+07:00', up_at: base.date_from, status: 'up' },
    { id: 10, device_id: 1, down_at: base.date_from, up_at: base.date_from, status: 'up' },
    { id: 11, device_id: 1, down_at: base.date_to_exclusive, status: 'down' },
    { id: 12, device_id: 3, down_at: '2026-01-01T01:00:00+07:00', up_at: null, status: 'up' },
    { id: 13, device_id: 2, down_at: '2026-01-01T01:00:00+07:00', up_at: '2026-01-01T00:00:00+07:00', status: 'up' },
    { id: 14, device_id: 2, down_at: '2026-01-01T02:00:00+07:00', up_at: '2026-01-01T02:00:00+07:00', status: 'up' },
    { id: 15, device_id: 1, down_at: '2027-01-01T00:00:00+07:00', status: 'down' }
  ] });
  await NetworkDevices.destroy({ where: { id: 3 } });
  const summary = await service.execute('summary', base);
  assert.equal(summary.data.matched_incident_count, 4);
  assert.equal(summary.data.unknown_incident_count, 2);
  assert.equal(summary.data.unlinked_incident_count, 1);
  assert.equal(summary.data.duration_unknown_count, 2);
  assert.equal(summary.data.total_duration_in_range_ms, 0);
  assert.equal(summary.data.duration_is_complete, false);
  assert.equal(summary.meta.data_quality.invalid_interval_record_count, 2);
  const query = { ...base, snapshot_token: summary.meta.snapshot_token, sort_by: 'duration_ms' };
  for (const sort_order of ['asc', 'desc']) {
    const result = await service.execute('incidents', { ...query, sort_order });
    assert.deepEqual(result.data.items.map(row => row.incident_id), ['10', '14', '12', '13']);
    assert.equal(result.data.items[2].device_id, null);
    assert.equal(result.data.items[2].pea_name, 'สำนักงานเก่า');
  }
  const graph = await service.execute('dashboard', { ...base, snapshot_token: summary.meta.snapshot_token });
  assert.equal(graph.data.daily[0].duration_is_complete, false);
  assert.equal(graph.data.top_devices.some(row => row.device_id === '3'), false);
});

test('empty, unknown coverage, leap day, month crossing and future buckets', async t => {
  const { service } = await setup(t, { time: Date.parse('2024-03-01T12:00:00+07:00'), records: [
    { id: 1, device_id: 1, down_at: '2024-02-29T23:00:00+07:00', up_at: null, status: 'down' }
  ] });
  const query = { date_from: '2024-02-01T00:00:00+07:00', date_to_exclusive: '2024-03-04T00:00:00+07:00' };
  const graph = await service.execute('dashboard', query);
  assert.equal(graph.data.daily.length, 32);
  assert.equal(graph.data.daily[0].coverage_status, 'unknown');
  assert.equal(graph.data.daily[0].started_incident_count, null);
  assert.equal(graph.data.daily[28].duration_in_range_ms, hour);
  assert.equal(graph.data.daily[29].duration_in_range_ms, 12 * hour);
  assert.equal(graph.data.daily[30].coverage_status, 'future');
  assert.equal(graph.data.daily[30].duration_in_range_ms, null);
  assert.equal(graph.data.monthly[0].duration_in_range_ms, hour);
  assert.equal(graph.data.monthly[1].duration_in_range_ms, 12 * hour);
  assert.equal(graph.data.totals.total_duration_in_range_ms, 13 * hour);
  for (const bucket of graph.data.daily.filter(row => row.started_incident_count)) {
    const drill = await service.execute('incidents', { date_from: bucket.period_start, date_to_exclusive: bucket.period_end_exclusive,
      snapshot_token: graph.meta.snapshot_token, match: 'started' });
    assert.equal(drill.data.pagination.total_items, bucket.started_incident_count);
  }
  const empty = await service.execute('summary', { ...query, q: 'missing', snapshot_token: graph.meta.snapshot_token });
  assert.equal(empty.data.matched_incident_count, 0);
  assert.equal(empty.data.duration_is_complete, true);
});

test('selectors cover intervening years, open incidents, unique Thai provinces and no rows', async t => {
  const env = await setup(t, { records: [
    { device_id: 1, down_at: '2023-12-31T23:00:00+07:00', up_at: '2024-01-01T00:00:00+07:00', status: 'up' },
    { device_id: 2, down_at: '2024-12-31T23:00:00+07:00', status: 'down' }
  ] });
  const result = await env.service.execute('selectors', {});
  assert.deepEqual(result.data.available_years, [2026, 2025, 2024, 2023]);
  assert.equal(result.meta, undefined);
  assert.equal(result.data.provinces.length, 2);
  await env.DeviceDowntime.destroy({ where: {} });
  assert.deepEqual((await env.service.execute('selectors', {})).data.available_years, []);
});

test('strict query validation and anomalous source normalization', () => {
  const cases = [
    [{ date_from: '2026-01-01T00:00:00' }, 'INVALID_DATE_RANGE'],
    [{ date_from: '2026-02-30T00:00:00Z' }, 'INVALID_DATE_RANGE'],
    [{ date_from: '2026-01-01T25:00:00Z' }, 'INVALID_DATE_RANGE'],
    [{ date_to_exclusive: base.date_from }, 'INVALID_DATE_RANGE'],
    [{ date_to_exclusive: '2027-01-03T00:00:00+07:00' }, 'DATE_RANGE_TOO_LARGE'],
    [{ year: '2026' }, 'INVALID_QUERY'], [{ page_size: '101' }, 'INVALID_QUERY'],
    [{ q: 'a'.repeat(201) }, 'INVALID_QUERY'], [{ page: '1.5' }, 'INVALID_QUERY'],
    [{ status: 'down' }, 'INVALID_QUERY'], [{ match: 'anything' }, 'INVALID_QUERY'],
    [{ timezone: 'UTC' }, 'INVALID_TIMEZONE'], [{ device_id: '-1' }, 'INVALID_QUERY'],
    [{ sort_by: 'id' }, 'INVALID_SORT'], [{ sort_order: 'whatever' }, 'INVALID_SORT'],
    [{ q: ['a', 'b'] }, 'INVALID_QUERY'], [{ contract: 'v2' }, 'INVALID_QUERY'],
    [{ snapshot_token: 'x' }, 'INVALID_SNAPSHOT']
  ];
  for (const [change, code] of cases) assert.throws(() => parseQuery({ ...base, ...change }, 'incidents'), { code });
  assert.throws(() => parseQuery({ ...base, page: '1' }, 'dashboard'), { code: 'INVALID_QUERY' });
  assert.throws(() => parseQuery({ contract: 'v2' }, 'selectors'), { code: 'INVALID_QUERY' });
  assert.throws(() => safeNumber('9007199254740992'), { code: 'INTERNAL_ERROR' });
  const invalid = normalize({ id: 1, down_at: 'bad', status: 'up', up_at: null }, asOf);
  assert.equal(invalid.invalid_start, true);
  assert.equal(invalid.status, 'unknown');
  assert.equal(invalid.duration_ms, null);
  assert.equal(normalize({ id: 1, down_at: base.date_from, up_at: null, status: null }, asOf).status, 'unknown');
  assert.equal(normalize({ id: 1, down_at: base.date_from, up_at: base.date_to_exclusive, status: 'down' }, asOf).status, 'unknown');
});

test('future start, metadata quality filtering and SQL pagination', async t => {
  const sql = [];
  const env = await setup(t, { logging: message => sql.push(message) });
  await assert.rejects(env.service.execute('summary', { ...base, date_from: '2026-01-03T00:00:00Z', date_to_exclusive: '2026-01-04T00:00:00Z' }), { code: 'INVALID_DATE_RANGE' });
  const first = await env.service.execute('summary', base);
  // Inject legacy-corrupt values into the materialized fixture to exercise SQL quality paths.
  await env.DowntimeQueryRow.create({ snapshot_token: first.meta.snapshot_token, incident_id: 9, status: 'unknown',
    pea_name: 'bad-start', down_ms: null, invalid_start: true, invalid_interval: false });
  const query = { ...base, snapshot_token: first.meta.snapshot_token };
  const quality = await env.service.execute('summary', query);
  assert.equal(quality.meta.data_quality.invalid_start_record_count, 1);
  assert.equal(quality.data.matched_incident_count, 3);
  const filtered = await env.service.execute('summary', { ...query, q: 'อุบล' });
  assert.equal(filtered.meta.data_quality.invalid_start_record_count, 0);
  sql.length = 0;
  await env.service.execute('incidents', { ...query, page: '2', page_size: '1' });
  assert.ok(sql.some(statement => /LIMIT 1, 1/.test(statement)), sql.join('\n'));
  assert.ok(!sql.some(statement => /FROM `DeviceDowntimes`/.test(statement)));
});

test('migration rollback and capacity failure are explicit', async t => {
  const env = await setup(t);
  const limited = createService(env, { now: () => asOf, maxSnapshots: 0 });
  await assert.rejects(limited.execute('summary', base), { code: 'SERVICE_UNAVAILABLE', status: 503 });
  await migration.down(env.sequelize.getQueryInterface());
  const tables = await env.sequelize.getQueryInterface().showAllTables();
  assert.equal(tables.includes('DowntimeQueryRows'), false);
  assert.equal(tables.includes('DeviceDowntimes'), true);
});

test('more than one source batch: SQL pages and duration ordering lose no incidents', async t => {
  const records = Array.from({ length: 1005 }, (_, index) => ({
    id: index + 1, device_id: index % 2 + 1, status: 'up', down_at: base.date_from,
    up_at: new Date(Date.parse(base.date_from) + (index % 3 === 0 ? 20 : 100) * 1000)
  }));
  const { service } = await setup(t, { records });
  const summary = await service.execute('summary', base);
  assert.equal(summary.data.matched_incident_count, 1005);
  const query = { ...base, snapshot_token: summary.meta.snapshot_token };
  const ids = [];
  for (let page = 1; page <= 11; page++) {
    const result = await service.execute('incidents', { ...query, page: String(page), page_size: '100', sort_by: 'duration_ms', sort_order: 'asc' });
    ids.push(...result.data.items.map(item => Number(item.incident_id)));
  }
  assert.equal(new Set(ids).size, 1005);
  assert.deepEqual(ids.slice(0, 3), [1, 4, 7]);
  assert.equal(ids[335], 2);
  const graph = await service.execute('dashboard', query);
  assert.equal(graph.data.daily[0].started_incident_count, 1005);
  assert.equal(graph.data.daily[0].duration_in_range_ms, summary.data.total_duration_in_range_ms);
});
