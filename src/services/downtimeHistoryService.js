'use strict';

const crypto = require('crypto');
const { Op, Transaction, literal } = require('sequelize');
const contract = require('./downtimeContract');
const { ContractError, safeNumber, iso } = contract;
const TTL = 10 * 60 * 1000;
const BATCH = 1000;
// All read routes expose the same public dataset. Change this version if that policy changes.
const PUBLIC_SCOPE = crypto.createHash('sha256').update('downtime:public:all-devices:v1').digest('hex');

function createService(models, { now = Date.now, maxSnapshots = 100 } = {}) {
  const { sequelize, DeviceDowntime, NetworkDevices, DowntimeQuerySnapshot: Snapshot, DowntimeQueryRow: Row } = models;
  const quote = name => sequelize.getQueryInterface().queryGenerator.quoteIdentifier(name);
  const c = quote;
  const min = (a, b) => `(CASE WHEN ${a} < ${b} THEN ${a} ELSE ${b} END)`;
  const max = (a, b) => `(CASE WHEN ${a} > ${b} THEN ${a} ELSE ${b} END)`;
  const duration = q => `(CASE WHEN ${c('end_ms')} IS NULL THEN NULL ELSE ${max('0', `(${min(c('end_ms'), q.to)} - ${max(c('down_ms'), q.from)})`)} END)`;
  const started = (q, asOf) => `${c('down_ms')} >= ${q.from} AND ${c('down_ms')} < ${q.to} AND ${c('down_ms')} <= ${asOf}`;
  const serviceError = () => new ContractError('SERVICE_UNAVAILABLE', 'Snapshot capacity is full; retry after existing snapshots expire', [], 503);

  async function createSnapshot(scope = PUBLIC_SCOPE) {
    const time = now();
    // Removing the parent deletes cached rows too. No source history is changed.
    await Snapshot.destroy({ where: { expires_ms: { [Op.lte]: time } } });
    if (await Snapshot.count() >= maxSnapshots) throw serviceError();
    const token = crypto.randomBytes(32).toString('hex');
    return sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async transaction => {
      const snapshot = await Snapshot.create({ token, scope, as_of_ms: time, expires_ms: time + TTL, offline_count: null }, { transaction });
      let after = 0;
      let offlineCount = 0;
      const offlineDevices = new Set();
      while (true) {
        const records = await DeviceDowntime.findAll({
          where: { id: { [Op.gt]: after } }, order: [['id', 'ASC']], limit: BATCH,
          include: [{ model: NetworkDevices, as: 'device', required: false, paranoid: false,
            attributes: ['id', 'pea_name', 'gateway', 'province', 'deletedAt'] }], transaction
        });
        if (!records.length) break;
        const rows = records.map(record => {
          const raw = record.get({ plain: true });
          const normalized = contract.normalize(raw, time);
          // Preserve the legacy source (down + null up_at), but count distinct surviving devices.
          if (raw.status === 'down' && raw.up_at == null && normalized.device_id !== null) offlineDevices.add(normalized.device_id);
          return { ...normalized, snapshot_token: token };
        });
        await Row.bulkCreate(rows, { transaction });
        after = records[records.length - 1].id;
        if (records.length < BATCH) break;
      }
      offlineCount = offlineDevices.size;
      await snapshot.update({ offline_count: offlineCount }, { transaction });
      return snapshot.get({ plain: true });
    });
  }

  async function getSnapshot(q, scope) {
    const time = now();
    if (!q.token && q.from > time) throw new ContractError('INVALID_DATE_RANGE', 'date_from cannot be in the future', ['date_from']);
    const snapshot = q.token ? await Snapshot.findByPk(q.token, { raw: true }) : await createSnapshot(scope);
    if (!snapshot || Number(snapshot.expires_ms) <= now()) throw new ContractError('SNAPSHOT_EXPIRED', 'Snapshot expired; refresh the complete view', ['snapshot_token'], 410);
    if (snapshot.scope !== scope) throw new ContractError('INVALID_SNAPSHOT', 'Snapshot is not valid for this access scope', ['snapshot_token']);
    if (q.from > Number(snapshot.as_of_ms)) throw new ContractError('INVALID_DATE_RANGE', 'date_from cannot exceed snapshot as_of', ['date_from']);
    return snapshot;
  }

  function whereFor(q, snapshot, withDates = true) {
    const terms = [{ snapshot_token: snapshot.token }];
    if (q.q) {
      // INSTR uses a literal substring: %, _ and backslash have no wildcard meaning.
      const needle = sequelize.escape(q.q.toLowerCase());
      terms.push(literal(`(${['device_name', 'pea_name', 'gateway'].map(name => `INSTR(LOWER(COALESCE(${c(name)}, '')), ${needle}) > 0`).join(' OR ')})`));
    }
    if (q.province) {
      // MySQL's default collation is case-insensitive; province requires exact matching.
      terms.push(sequelize.getDialect() === 'mysql'
        ? literal(`BINARY ${c('province')} = BINARY ${sequelize.escape(q.province)}`)
        : { province: q.province });
    }
    if (q.deviceId) terms.push({ device_id: q.deviceId });
    if (q.status) terms.push({ status: q.status });
    if (withDates) {
      const asOf = Number(snapshot.as_of_ms);
      const end = Math.min(q.to, asOf);
      const down = c('down_ms');
      if (q.match === 'started') terms.push(literal(`(${started(q, asOf)})`));
      else terms.push(literal(`(${down} < ${end} AND ${down} <= ${asOf} AND (
        (${c('end_ms')} IS NOT NULL AND ${c('end_ms')} > ${q.from}) OR
        (${c('status')} = 'resolved' AND ${c('up_ms')} = ${down} AND ${down} >= ${q.from}) OR
        (${c('end_ms')} IS NULL AND ${down} >= ${q.from})
      ))`));
    }
    return { [Op.and]: terms };
  }

  async function meta(q, snapshot) {
    const quality = await Row.findOne({
      where: whereFor(q, snapshot, false), raw: true,
      attributes: [
        [literal(`COALESCE(SUM(CASE WHEN ${c('invalid_start')} THEN 1 ELSE 0 END), 0)`), 'invalid_start_record_count'],
        [literal(`COALESCE(SUM(CASE WHEN ${c('invalid_interval')} THEN 1 ELSE 0 END), 0)`), 'invalid_interval_record_count']
      ]
    });
    return {
      contract_version: 'v2', snapshot_token: snapshot.token, as_of: iso(snapshot.as_of_ms),
      snapshot_expires_at: iso(snapshot.expires_ms), data_updated_at: null, timezone: 'Asia/Bangkok',
      applied_filters: { date_from: iso(q.from), date_to_exclusive: iso(q.to), match: q.match,
        q: q.q, province: q.province, device_id: q.deviceId, status: q.status },
      coverage: { status: 'unknown', known_from: null, known_to_exclusive: null, gaps: [] },
      data_quality: Object.fromEntries(Object.entries(quality).map(([key, value]) => [key, safeNumber(value)]))
    };
  }

  async function totals(q, snapshot) {
    const countIf = predicate => `COALESCE(SUM(CASE WHEN ${predicate} THEN 1 ELSE 0 END), 0)`;
    const sql = {
      matched_incident_count: 'COUNT(*)',
      started_incident_count: countIf(started(q, Number(snapshot.as_of_ms))),
      affected_device_count: `COUNT(DISTINCT ${c('device_id')})`,
      open_incident_count: countIf(`${c('status')} = 'open'`),
      open_device_count: `COUNT(DISTINCT CASE WHEN ${c('status')} = 'open' THEN ${c('device_id')} ELSE NULL END)`,
      resolved_incident_count: countIf(`${c('status')} = 'resolved'`),
      unknown_incident_count: countIf(`${c('status')} = 'unknown'`),
      unlinked_incident_count: countIf(`${c('device_id')} IS NULL`),
      total_duration_in_range_ms: `COALESCE(SUM(${duration(q)}), 0)`,
      duration_unknown_count: countIf(`${c('duration_ms')} IS NULL`)
    };
    const result = await Row.findOne({ where: whereFor(q, snapshot), raw: true,
      attributes: Object.entries(sql).map(([name, expression]) => [literal(expression), name]) });
    const data = Object.fromEntries(Object.entries(result).map(([key, value]) => [key, safeNumber(value)]));
    data.duration_is_complete = data.duration_unknown_count === 0;
    return data;
  }

  async function incidents(q, snapshot) {
    const where = whereFor(q, snapshot);
    const column = { down_at: 'down_ms', up_at: 'up_ms', duration_ms: 'duration_ms', province: 'province' }[q.sortBy];
    const total = safeNumber(await Row.count({ where }));
    const offset = (q.page - 1) * q.pageSize;
    const rows = offset >= total ? [] : await Row.findAll({ where, raw: true, limit: q.pageSize, offset,
      order: [[literal(`CASE WHEN ${c(column)} IS NULL THEN 1 ELSE 0 END`), 'ASC'], [column, q.sortOrder.toUpperCase()], ['incident_id', 'ASC']] });
    return { items: rows.map(row => contract.item(row, q)),
      pagination: { page: q.page, page_size: q.pageSize, total_items: total, total_pages: Math.ceil(total / q.pageSize) },
      sort: { by: q.sortBy, order: q.sortOrder } };
  }

  async function dashboard(q, snapshot) {
    const sum = await totals(q, snapshot);
    const asOf = Number(snapshot.as_of_ms);
    const daily = contract.buckets(q, asOf);
    const monthly = contract.buckets(q, asOf, true);
    let after = 0;
    // Charts need all matching intervals, read in bounded batches; list pagination stays in SQL.
    while (true) {
      const rows = await Row.findAll({ where: { [Op.and]: [whereFor(q, snapshot), { incident_id: { [Op.gt]: after } }] },
        attributes: ['incident_id', 'down_ms', 'end_ms'], raw: true, order: [['incident_id', 'ASC']], limit: BATCH });
      for (const row of rows) {
        contract.addToBuckets(daily, row, q, asOf);
        contract.addToBuckets(monthly, row, q, asOf);
      }
      if (rows.length < BATCH) break;
      after = rows[rows.length - 1].incident_id;
    }
    const top = await Row.findAll({
      where: { [Op.and]: [whereFor(q, snapshot), { device_id: { [Op.ne]: null } }] }, raw: true,
      attributes: ['device_id', ...['device_name', 'pea_name', 'gateway', 'province'].map(name => [literal(`MAX(${c(name)})`), name]),
        [literal('COUNT(*)'), 'incident_count'], [literal(`COALESCE(SUM(${duration(q)}), 0)`), 'total_duration_in_range_ms'],
        [literal(`SUM(CASE WHEN ${c('duration_ms')} IS NULL THEN 1 ELSE 0 END)`), 'duration_unknown_count']],
      group: ['device_id'], order: [[literal('incident_count'), 'DESC'], [literal('total_duration_in_range_ms'), 'DESC'], ['device_id', 'ASC']], limit: q.topLimit
    });
    return {
      totals: Object.fromEntries(['matched_incident_count', 'started_incident_count', 'total_duration_in_range_ms', 'duration_unknown_count'].map(key => [key, sum[key]])),
      daily: contract.serializeBuckets(daily), monthly: contract.serializeBuckets(monthly),
      top_devices: top.map((row, index) => ({ ...row, rank: index + 1, device_id: String(row.device_id),
        incident_count: safeNumber(row.incident_count), total_duration_in_range_ms: safeNumber(row.total_duration_in_range_ms),
        duration_unknown_count: safeNumber(row.duration_unknown_count) })), unlinked_incident_count: sum.unlinked_incident_count
    };
  }

  async function selectors() {
    const years = new Set();
    const provinces = new Set();
    const asOf = now();
    const yearOf = time => new Date(time + contract.THAI_OFFSET).getUTCFullYear();
    await sequelize.transaction({ isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async transaction => {
      let after = 0;
      while (true) {
        const records = await DeviceDowntime.findAll({
          where: { id: { [Op.gt]: after } }, order: [['id', 'ASC']], limit: BATCH, transaction,
          include: [{ model: NetworkDevices, as: 'device', required: false, paranoid: false,
            attributes: ['id', 'pea_name', 'gateway', 'province', 'deletedAt'] }]
        });
        for (const record of records) {
          const row = contract.normalize(record.get({ plain: true }), asOf);
          if (row.province) provinces.add(row.province);
          if (row.down_ms === null || row.down_ms > asOf) continue;
          const end = row.end_ms === null || row.end_ms === row.down_ms ? row.down_ms : row.status === 'open' ? row.end_ms : row.end_ms - 1;
          for (let year = yearOf(row.down_ms); year <= yearOf(end); year++) years.add(year);
        }
        if (records.length < BATCH) break;
        after = records[records.length - 1].id;
      }
    });
    return { available_years: [...years].sort((a, b) => b - a),
      provinces: [...provinces].sort((a, b) => a.localeCompare(b, 'th')).map(value => ({ value, label: value })), timezone: 'Asia/Bangkok' };
  }

  async function execute(endpoint, query, scope = PUBLIC_SCOPE) {
    const q = contract.parseQuery(query, endpoint);
    if (endpoint === 'selectors') return { success: true, data: await selectors() };
    const snapshot = await getSnapshot(q, scope);
    let data;
    if (endpoint === 'incidents') data = await incidents(q, snapshot);
    else if (endpoint === 'dashboard') data = await dashboard(q, snapshot);
    else data = { ...await totals(q, snapshot), current_state: { scope: 'all_authorized_devices',
      currently_offline_device_count: snapshot.offline_count === null ? null : safeNumber(snapshot.offline_count),
      observed_at: null } };
    const responseMeta = await meta(q, snapshot);
    // Never return a partial result if concurrent expiry cleanup removed the snapshot.
    if (Number(snapshot.expires_ms) <= now()) throw new ContractError('SNAPSHOT_EXPIRED', 'Snapshot expired; refresh the complete view', ['snapshot_token'], 410);
    return { success: true, data, meta: responseMeta };
  }
  return { execute };
}
module.exports = { createService };
