'use strict';

// Opt-in verification against connection-local TEMPORARY copies. No persistent schema/data writes.
// Run: node scripts/check-downtime-history-mysql.js
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { Sequelize, DataTypes } = require('sequelize');
const { createService } = require('../src/services/downtimeHistoryService');
const config = require('../src/config/database')[process.env.NODE_ENV || 'development'];
if (config.dialect !== 'mysql') throw new Error('This verification requires MySQL');
const sql = [];
const sequelize = new Sequelize(config.database, config.username, config.password, {
  ...config, pool: { max: 1, min: 1, idle: 60000 }, logging: statement => sql.push(statement)
});

async function main() {
  const source = await sequelize.query('SELECT COUNT(*) AS incident_count, COUNT(DISTINCT device_id) AS device_count FROM DeviceDowntimes', { type: Sequelize.QueryTypes.SELECT });
  const NetworkDevices = sequelize.define('NetworkDevices', {
    pea_name: DataTypes.STRING, gateway: DataTypes.STRING, province: DataTypes.STRING
  }, { tableName: 'ne2_check_devices', paranoid: true });
  const DeviceDowntime = require('../src/models/devicedowntime')(sequelize, DataTypes);
  DeviceDowntime.tableName = 'ne2_check_incidents';
  DeviceDowntime.associate({ NetworkDevices });
  const Snapshot = require('../src/models/downtimequerysnapshot')(sequelize, DataTypes);
  Snapshot.tableName = 'ne2_check_snapshots';
  const Row = require('../src/models/downtimequeryrow')(sequelize, DataTypes);
  Row.tableName = 'ne2_check_rows';
  await sequelize.query('CREATE TEMPORARY TABLE ne2_check_devices LIKE network_devices');
  await sequelize.query('CREATE TEMPORARY TABLE ne2_check_incidents LIKE DeviceDowntimes');
  await sequelize.query(`CREATE TEMPORARY TABLE ne2_check_snapshots (
    token VARCHAR(64) PRIMARY KEY, scope VARCHAR(64) NOT NULL, as_of_ms BIGINT NOT NULL,
    expires_ms BIGINT NOT NULL, offline_count INT NULL, INDEX (expires_ms)) ENGINE=InnoDB`);
  await sequelize.query(`CREATE TEMPORARY TABLE ne2_check_rows (
    snapshot_token VARCHAR(64) NOT NULL, incident_id INT NOT NULL, device_id INT NULL,
    device_name VARCHAR(255), pea_name VARCHAR(255), gateway VARCHAR(255), province VARCHAR(255),
    down_ms BIGINT, up_ms BIGINT, end_ms BIGINT, duration_ms BIGINT, status VARCHAR(16) NOT NULL,
    invalid_start TINYINT(1) NOT NULL, invalid_interval TINYINT(1) NOT NULL,
    PRIMARY KEY (snapshot_token, incident_id)) ENGINE=InnoDB`);
  await sequelize.transaction(async transaction => {
    await sequelize.query('INSERT INTO ne2_check_devices SELECT * FROM network_devices', { transaction });
    await sequelize.query('INSERT INTO ne2_check_incidents SELECT * FROM DeviceDowntimes', { transaction });
  });
  const service = createService({ sequelize, NetworkDevices, DeviceDowntime, DowntimeQuerySnapshot: Snapshot, DowntimeQueryRow: Row });
  const year = new Date(Date.now() + 7 * 3600000).getUTCFullYear();
  const query = { date_from: `${year}-01-01T00:00:00+07:00`, date_to_exclusive: `${year + 1}-01-01T00:00:00+07:00` };
  const timings = {};
  async function timed(name, work) {
    const start = performance.now();
    const result = await work();
    timings[name] = Math.round((performance.now() - start) * 100) / 100;
    return result;
  }
  const summary = await timed('create_snapshot_and_summary_ms', () => service.execute('summary', query));
  const shared = { ...query, snapshot_token: summary.meta.snapshot_token };
  sql.length = 0;
  const list = await timed('incidents_page_ms', () => service.execute('incidents', shared));
  const pageSql = sql.find(statement => /SELECT .*FROM `ne2_check_rows`/.test(statement) && /LIMIT/.test(statement)).replace(/^Executing \([^)]*\): /, '');
  const pagePlan = await sequelize.query(`EXPLAIN ${pageSql}`, { type: Sequelize.QueryTypes.SELECT });
  const graph = await timed('dashboard_ms', () => service.execute('dashboard', shared));
  await timed('selectors_ms', () => service.execute('selectors', {}));
  assert.equal(list.data.pagination.total_items, summary.data.matched_incident_count);
  assert.equal(graph.data.totals.matched_incident_count, summary.data.matched_incident_count);
  assert.equal(graph.data.totals.total_duration_in_range_ms, summary.data.total_duration_in_range_ms);
  for (const buckets of [graph.data.daily, graph.data.monthly]) {
    assert.equal(buckets.reduce((sum, row) => sum + (row.started_incident_count || 0), 0), summary.data.started_incident_count);
    assert.equal(buckets.reduce((sum, row) => sum + (row.duration_in_range_ms || 0), 0), summary.data.total_duration_in_range_ms);
  }
  // Exercise MySQL's exact province predicate and numeric ordering, without publishing private values.
  const province = list.data.items.find(row => row.province)?.province;
  if (province) await service.execute('incidents', { ...shared, province, sort_by: 'duration_ms', sort_order: 'asc' });
  const empty = await service.execute('summary', { ...shared, q: '__nonexistent_downtime_check_982471__' });
  assert.equal(empty.data.matched_incident_count, 0);
  const frozen = await service.execute('incidents', shared);
  await sequelize.query("UPDATE ne2_check_incidents SET status = 'unknown' WHERE id > 0");
  assert.deepEqual((await service.execute('incidents', shared)).data, frozen.data);
  const refreshed = await service.execute('summary', query);
  assert.equal(refreshed.data.open_incident_count, 0);
  const sourcePlan = await sequelize.query('EXPLAIN SELECT id, device_id, down_at, up_at, status FROM DeviceDowntimes WHERE id > 0 ORDER BY id ASC LIMIT 1000', { type: Sequelize.QueryTypes.SELECT });
  const report = { verified_at: new Date().toISOString(), dialect: 'mysql', timezone: config.timezone,
    source_counts: source[0], tested_year: year, matched_incident_count: summary.data.matched_incident_count,
    timings, source_batch_plan: sourcePlan, snapshot_page_plan: pagePlan,
    notes: ['Connection-local temporary copies; persistent source tables were not modified.',
      'Single warm run on the configured development database; not a load test or a production latency guarantee.',
      'Snapshot page uses its composite primary key; duration/date sort may use filesort. No speculative source indexes added.'] };
  fs.writeFileSync(path.join(__dirname, '../docs/downtime-history-performance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {
  // Avoid logging queries containing source metadata or connection credentials.
  console.error(JSON.stringify({ error: error.name, code: error.original?.code, message: error.original ? undefined : error.message }));
  process.exitCode = 1;
}).finally(() => sequelize.close());
