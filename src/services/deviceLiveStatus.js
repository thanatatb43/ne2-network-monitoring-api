/**
 * Turns a stored DeviceMetrics row (the last measurement of a device) into a status
 * that is safe to show as "current". See docs/REMAINING_UX_UI_BACKEND_RESPONSE.md, N1.
 *
 * Field precedence for anything displaying a device's current state:
 *   1. live_status - 'up' | 'down' | 'unknown'. The only field meant to drive a
 *      "current status" indicator. 'unknown' when there is no measurement, when the
 *      last one is older than the stale threshold, or when the stored value isn't one
 *      we recognise.
 *   2. alive       - true | false | null. Exactly live_status as a boolean
 *      (null = unknown). Derived from live_status, so the two can never disagree.
 *   3. status      - the raw last measured value, left untouched for existing callers.
 *      Never show it as current on its own - only as "last measured <status> at
 *      <checked_at>".
 */

// The ping loop covers every device once per ~21.5 min (measured from LatencyLogs
// spacing and the 21-29 min DeviceDowntime cluster). Two full cycles plus margin
// tolerates one missed cycle before a result stops counting as current. Overridable
// with DEVICE_STATUS_STALE_SECONDS if the loop's pace changes.
const DEFAULT_STALE_AFTER_SECONDS = 45 * 60;

const staleAfterSeconds = () => {
  const v = parseInt(process.env.DEVICE_STATUS_STALE_SECONDS, 10);
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_STALE_AFTER_SECONDS;
};

// The ping loop stores checked_at shifted by DB_TIMEZONE_OFFSET hours, so the same
// shift has to be applied to "now" for the age to come out right.
const storedOffsetMs = () => {
  const h = process.env.DB_TIMEZONE_OFFSET !== undefined ? parseInt(process.env.DB_TIMEZONE_OFFSET, 10) : 0;
  return (Number.isInteger(h) ? h : 0) * 60 * 60 * 1000;
};

const describeLiveStatus = (metric, nowMs = Date.now()) => {
  if (!metric || !metric.checked_at) {
    return { live_status: 'unknown', alive: null, stale: true, age_seconds: null };
  }

  const measuredMs = new Date(metric.checked_at).getTime();
  if (!Number.isFinite(measuredMs)) {
    return { live_status: 'unknown', alive: null, stale: true, age_seconds: null };
  }

  const ageSeconds = Math.max(0, Math.round((nowMs + storedOffsetMs() - measuredMs) / 1000));
  if (ageSeconds > staleAfterSeconds()) {
    return { live_status: 'unknown', alive: null, stale: true, age_seconds: ageSeconds };
  }

  if (metric.status === 'up') return { live_status: 'up', alive: true, stale: false, age_seconds: ageSeconds };
  if (metric.status === 'down') return { live_status: 'down', alive: false, stale: false, age_seconds: ageSeconds };
  return { live_status: 'unknown', alive: null, stale: false, age_seconds: ageSeconds };
};

const liveStatusMeta = () => ({
  stale_after_seconds: staleAfterSeconds(),
  status_precedence: ['live_status', 'alive', 'status'],
  measured_at_field: 'checked_at',
  // The background loop does not run in this window, so every device goes 'unknown'
  // part-way through it. That is correct, not an outage.
  probe_paused_window: '00:00-05:00 Asia/Bangkok'
});

module.exports = { describeLiveStatus, liveStatusMeta, staleAfterSeconds };
