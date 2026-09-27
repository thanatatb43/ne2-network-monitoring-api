'use strict';

const DAY = 86400000;
const THAI_OFFSET = 7 * 3600000;
class ContractError extends Error {
  constructor(code, message, fields = [], status = 400) {
    super(message);
    Object.assign(this, { code, fields, status });
  }
}
const fail = (code, message, fields) => { throw new ContractError(code, message, fields); };
function integer(value, fallback, min, max, field) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    fail('INVALID_QUERY', `${field} must be an integer from ${min} to ${max}`, [field]);
  }
  return Number(value);
}
function timestamp(value, field) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value || '');
  if (!match) fail('INVALID_DATE_RANGE', `${field} must be ISO8601 with a timezone`, [field]);
  const [, y, m, d, h, minute, s, , zone] = match;
  const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  if (Number(y) < 1000 || +m < 1 || +m > 12 || +d < 1 || +d > days || +h > 23 || +minute > 59 || +s > 59 ||
      (zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_DATE_RANGE', `${field} is not a valid timestamp`, [field]);
  }
  return Date.parse(value);
}
function parseQuery(query, endpoint) {
  const shared = ['date_from', 'date_to_exclusive', 'timezone', 'match', 'q', 'province', 'device_id', 'status', 'snapshot_token'];
  const extra = endpoint === 'incidents' ? ['page', 'page_size', 'sort_by', 'sort_order'] : endpoint === 'dashboard' ? ['contract', 'top_limit'] : endpoint === 'summary' ? ['contract'] : [];
  const allowed = endpoint === 'selectors' ? [] : [...shared, ...extra];
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== 'string') fail('INVALID_QUERY', `Unsupported or repeated query: ${key}`, [key]);
  }
  if (endpoint === 'selectors') return {};
  if (query.contract !== undefined && query.contract !== 'v2') fail('INVALID_QUERY', 'contract must be v2', ['contract']);
  const from = timestamp(query.date_from, 'date_from');
  const to = timestamp(query.date_to_exclusive, 'date_to_exclusive');
  if (from >= to) fail('INVALID_DATE_RANGE', 'date_from must precede date_to_exclusive', ['date_from', 'date_to_exclusive']);
  if (to - from > 366 * DAY) fail('DATE_RANGE_TOO_LARGE', 'Maximum range is 366 days', ['date_from', 'date_to_exclusive']);
  if (query.timezone !== undefined && query.timezone !== 'Asia/Bangkok') fail('INVALID_TIMEZONE', 'Only Asia/Bangkok is supported', ['timezone']);
  const match = query.match ?? 'overlap';
  if (!['overlap', 'started'].includes(match)) fail('INVALID_QUERY', 'Invalid match', ['match']);
  if (query.status !== undefined && !['open', 'resolved', 'unknown'].includes(query.status)) fail('INVALID_QUERY', 'Invalid status', ['status']);
  const q = query.q?.trim() || null;
  if (q && Array.from(q).length > 200) fail('INVALID_QUERY', 'q is limited to 200 characters', ['q']);
  const deviceId = query.device_id === undefined ? null : String(integer(query.device_id, null, 1, 2147483647, 'device_id'));
  const token = query.snapshot_token;
  if (token !== undefined && !/^[a-f0-9]{64}$/.test(token)) fail('INVALID_SNAPSHOT', 'Invalid snapshot token', ['snapshot_token']);
  const sortBy = query.sort_by ?? 'down_at';
  const sortOrder = query.sort_order ?? 'desc';
  if (!['down_at', 'up_at', 'duration_ms', 'province'].includes(sortBy) || !['asc', 'desc'].includes(sortOrder)) fail('INVALID_SORT', 'Invalid sort', ['sort_by', 'sort_order']);
  return {
    from, to, match, q, province: query.province || null, deviceId, status: query.status || null, token,
    page: integer(query.page, 1, 1, 2147483647, 'page'),
    pageSize: integer(query.page_size, 15, 1, 100, 'page_size'),
    sortBy, sortOrder, topLimit: integer(query.top_limit, 10, 1, 50, 'top_limit')
  };
}
function validMs(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isSafeInteger(ms) ? ms : null;
}
function normalize(record, asOf) {
  const down = validMs(record.down_at);
  const up = validMs(record.up_at);
  const invalidInterval = down !== null && (down > asOf || (up !== null && up < down));
  let status = 'unknown';
  if (down !== null && !invalidInterval) {
    if (record.status === 'down' && record.up_at == null) status = 'open';
    if (record.status === 'up' && up !== null && up >= down) status = 'resolved';
  }
  const end = status === 'open' ? asOf : status === 'resolved' ? Math.min(up, asOf) : null;
  const device = record.device;
  return {
    incident_id: String(record.id), device_id: device && !device.deletedAt ? String(device.id) : null,
    device_name: null, pea_name: device?.pea_name || null, gateway: device?.gateway || null,
    province: device?.province || null, down_ms: down, up_ms: up, end_ms: end, status,
    duration_ms: end === null ? null : Math.max(0, end - down),
    invalid_start: down === null, invalid_interval: invalidInterval
  };
}
function safeNumber(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new ContractError('INTERNAL_ERROR', 'Result exceeds the supported integer range', [], 500);
  return result;
}
const iso = value => value == null ? null : new Date(Number(value)).toISOString();
const rangeDuration = (row, query) => row.end_ms == null ? null : Math.max(0, Math.min(Number(row.end_ms), query.to) - Math.max(Number(row.down_ms), query.from));
function item(row, query) {
  return {
    incident_id: String(row.incident_id), device_id: row.device_id == null ? null : String(row.device_id),
    device_name: row.device_name, pea_name: row.pea_name, gateway: row.gateway, province: row.province,
    down_at: iso(row.down_ms), up_at: iso(row.up_ms), status: row.status,
    duration_ms: row.duration_ms == null ? null : safeNumber(row.duration_ms), duration_in_range_ms: rangeDuration(row, query)
  };
}
function buckets(query, asOf, monthly = false) {
  const local = new Date(query.from + THAI_OFFSET);
  let start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), monthly ? 1 : local.getUTCDate()) - THAI_OFFSET;
  const result = [];
  while (start < query.to) {
    const date = new Date(start + THAI_OFFSET);
    const end = monthly ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - THAI_OFFSET : start + DAY;
    result.push({ start, end, count: 0, duration: 0, observed: false, unknown: false, future: Math.max(start, query.from) > asOf });
    start = end;
  }
  return result;
}
function addToBuckets(list, row, query, asOf) {
  const down = Number(row.down_ms);
  for (const bucket of list) {
    if (bucket.future) continue;
    const from = Math.max(bucket.start, query.from);
    const to = Math.min(bucket.end, query.to);
    const starts = down >= from && down < to && down <= asOf;
    if (starts) { bucket.count++; bucket.observed = true; }
    if (row.end_ms == null) {
      if (starts) { bucket.unknown = true; bucket.observed = true; }
    } else {
      const duration = Math.max(0, Math.min(Number(row.end_ms), to, asOf) - Math.max(down, from));
      if (duration > 0) bucket.observed = true;
      bucket.duration = safeNumber(bucket.duration + duration);
    }
  }
}
function serializeBuckets(list) {
  const thaiIso = ms => new Date(ms + THAI_OFFSET).toISOString().replace('Z', '+07:00');
  return list.map(b => ({
    period_start: thaiIso(b.start), period_end_exclusive: thaiIso(b.end),
    started_incident_count: b.future || !b.observed ? null : b.count,
    duration_in_range_ms: b.future || !b.observed ? null : b.duration,
    coverage_status: b.future ? 'future' : 'unknown', duration_is_complete: !b.future && b.observed && !b.unknown
  }));
}
module.exports = { DAY, THAI_OFFSET, ContractError, parseQuery, normalize, safeNumber, iso, item, buckets, addToBuckets, serializeBuckets };
