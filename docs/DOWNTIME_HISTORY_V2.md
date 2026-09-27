# Downtime history API v2

Implemented for the supplied `DOWNTIME_HISTORY_BACKEND_API_SPEC.md` dated 2026-09-24.

## Decisions and schema mapping

- The user confirmed public access for the new endpoints and v2, limited to the specified fields, matching existing read routes. Existing write authorization is unchanged. All callers currently share one public authorization scope; there are no account-specific data scopes on these routes. Snapshot tokens are identifiers, not authentication credentials.
- The user confirmed existing MySQL timestamps represent Thailand time (`+07:00`). Development already used that timezone; test/production connection configurations now explicitly use it too. No historical timestamps were rewritten. This connection setting also applies to other models using the same connection.
- Source: `DeviceDowntimes.id`, signed INTEGER primary key, one row per incident. Device identity is `network_devices.id`, also INTEGER. API IDs are strings; ties sort by numeric incident/device ID ascending.
- `pea_name`, `province`, and `gateway` come from `network_devices`. There is no device-name field, so `device_name=null`. These are the device's stored metadata at snapshot creation, not a historical name/IP audit trail.
- `status=down` with null `up_at` and valid non-future `down_at` means open, as written by `notificationService.logDowntime`. `status=up` with valid `up_at >= down_at` means resolved. Missing, contradictory, or invalid state maps to unknown. An invalid/future start is excluded from date-matched results and counted in quality metadata; a reversed interval can appear as unknown if its start matches.
- Original `duration_ms` was calculated as `up_at - down_at`; v2 recalculates from timestamps and clamps to snapshot time. Overlapping duplicate records remain separate incidents; their durations are summed. Existing source comments document historical duplicates and reconciliation of stale open rows. This API does not repair those records.
- Soft-deleted devices remain in history with `device_id=null`, retaining stored device metadata. Hard deletes currently cascade to `DeviceDowntimes`; previously deleted incidents cannot be recovered. This change does not modify that existing foreign key.
- The legacy current-offline source is `DeviceDowntimes(status=down, up_at=NULL)`, not live pings. V2 uses that same source, counts distinct surviving devices and ignores history filters. There is no reliable observation timestamp for that source, so `observed_at=null`; the value is frozen with the snapshot. It may lag monitoring while reconciliation is pending.
- Availability aggregates exist, but do not prove uninterrupted collection or identify monitoring gaps. Therefore coverage is `unknown`, and `data_updated_at`, `known_from`, and `known_to_exclusive` are null. Empty buckets with unknown coverage are null; observed values are retained; wholly future buckets are marked `future`.

## Endpoints

| Method/path | Behavior |
|---|---|
| `GET /api/devices/downtime/incidents` | Shared filters, SQL pagination, deterministic sorting |
| `GET /api/devices/downtime/summary?contract=v2` | Filtered totals and snapshot metadata |
| `GET /api/devices/downtime/dashboard?contract=v2` | Daily/monthly buckets and top devices |
| `GET /api/devices/downtime/selectors` | All-history years and unique provinces; no snapshot/query parameters |

Omitting `contract` from summary/dashboard dispatches to the existing handler. Existing `/all`, `/devices`, and `/:id/downtime` handlers are unchanged. Unsupported explicit contract values are rejected with 400. No export, SLA, MTTR, or incident-detail endpoint was added.

Common queries require timezone-qualified `date_from` and `date_to_exclusive`, with an increasing range of at most 366 days. Only `timezone=Asia/Bangkok` is supported. Optional filters: `match=overlap|started` (default overlap), trimmed `q` (at most 200 Unicode characters), exact `province`, positive signed-INT `device_id`, and `status=open|resolved|unknown`. Empty province means no filter. Search is a case-insensitive literal substring of office/device name or IP; `%`, `_`, and backslash are not wildcards. Unknown/repeated query parameters are rejected.

Incidents accept `page` (default 1), `page_size` (default 15, maximum 100), `sort_by=down_at|up_at|duration_ms|province`, and `sort_order=asc|desc` (defaults down_at/desc). Nulls always sort last; ties use numeric incident ID ascending. Page beyond the end returns an empty page and real totals. `duration_ms` is the whole incident duration at snapshot time; `duration_in_range_ms` is the clipped duration.

Dashboard additionally accepts `top_limit` (default 10, maximum 50). Buckets use Thai calendar boundaries; their calculations are clipped to the filter and snapshot time. Graph counts represent starts, while totals/rankings represent matched incidents. Drill down with `match=started`, the bucket range intersected with the original filter range, the original non-date filters, and the same token. Do not request buckets starting after `as_of`.

## Snapshot implementation and limits

The migration adds `DowntimeQuerySnapshots` and `DowntimeQueryRows`. A repeatable-read transaction copies and normalizes source rows and joined device metadata in batches of 1,000 into persistent cache tables. The copy captures actual row versions, not just a timestamp. A cryptographically random 256-bit token identifies the copy. All later filtering, sorting, counts, and page limits operate against that copy; a token can be reused with other ranges/filters and drill-down.

TTL is 10 minutes. Expired cache rows are cascade-deleted when the next snapshot is created; an idle deployment may retain expired rows until then, but they cannot be served. Cleanup never deletes source history. Expired or no-longer-retained syntactically valid tokens return 410; malformed tokens and scope mismatches return 400. A request crossing its expiry returns 410 rather than partially computed results.

The default capacity guard refuses creation when 100 snapshots are already stored, returning 503 `SERVICE_UNAVAILABLE`. This is a capacity guard, not a rate limiter or a strict concurrent reservation: simultaneous creations can temporarily exceed that threshold. The cache is database-backed and works across API workers/restarts sharing that database. Source storage must provide transactional consistent reads (InnoDB on MySQL).

Each new token copies all authorized history, so creation cost and retained storage scale with history size and concurrent active snapshots. The frontend should share one token and only refresh when needed. List pagination never loads the whole result and slices it in the application. Dashboard interval splitting and selectors read bounded batches; dashboard work scales with matching rows and up to 367 calendar-day buckets for a non-midnight 366-day range. Very large deployments should benchmark this before rollout and may need SQL materialization/aggregation optimizations.

If access becomes account/role restricted, add request-time authorization and derive/revalidate a per-principal permission scope before invoking this service. Changing the public scope version invalidates older cached scopes. The internal scope check alone does not implement authentication; current public policy deliberately has no account boundary.

## Requests and example responses

All examples use synthetic data. Start with summary and share `meta.snapshot_token`:

```text
GET /api/devices/downtime/summary?contract=v2&date_from=2026-01-01T00:00:00%2B07:00&date_to_exclusive=2026-01-02T00:00:00%2B07:00
GET /api/devices/downtime/incidents?date_from=2026-01-01T00:00:00%2B07:00&date_to_exclusive=2026-01-02T00:00:00%2B07:00&snapshot_token=<token>&page=1&page_size=15
GET /api/devices/downtime/dashboard?contract=v2&date_from=2026-01-01T00:00:00%2B07:00&date_to_exclusive=2026-01-02T00:00:00%2B07:00&snapshot_token=<token>&top_limit=10
GET /api/devices/downtime/selectors
```

Successful summary for the specification's three-incident fixture, with the clock at 2026-01-02 12:00 Thailand time:

```json
{
  "success": true,
  "data": {
    "matched_incident_count": 3,
    "started_incident_count": 2,
    "affected_device_count": 2,
    "open_incident_count": 1,
    "open_device_count": 1,
    "resolved_incident_count": 2,
    "unknown_incident_count": 0,
    "unlinked_incident_count": 0,
    "total_duration_in_range_ms": 14400000,
    "duration_unknown_count": 0,
    "duration_is_complete": true,
    "current_state": {
      "scope": "all_authorized_devices",
      "currently_offline_device_count": 1,
      "observed_at": null
    }
  },
  "meta": {
    "contract_version": "v2",
    "snapshot_token": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123",
    "as_of": "2026-01-02T05:00:00.000Z",
    "snapshot_expires_at": "2026-01-02T05:10:00.000Z",
    "data_updated_at": null,
    "timezone": "Asia/Bangkok",
    "applied_filters": {
      "date_from": "2025-12-31T17:00:00.000Z",
      "date_to_exclusive": "2026-01-01T17:00:00.000Z",
      "match": "overlap", "q": null, "province": null, "device_id": null, "status": null
    },
    "coverage": { "status": "unknown", "known_from": null, "known_to_exclusive": null, "gaps": [] },
    "data_quality": { "invalid_start_record_count": 0, "invalid_interval_record_count": 0 }
  }
}
```

Example incident from that fixture (`data.items`); the response also contains pagination, sort, and the shared meta above:

```json
{
  "incident_id": "3", "device_id": "2", "device_name": null,
  "pea_name": "สำนักงานยโสธร", "gateway": "172.21.2.1", "province": "ยโสธร",
  "down_at": "2026-01-01T16:00:00.000Z", "up_at": null, "status": "open",
  "duration_ms": 46800000, "duration_in_range_ms": 3600000
}
```

Empty incidents return this `data`, with the same meta structure and the actual applied filters:

```json
{
  "items": [],
  "pagination": { "page": 1, "page_size": 15, "total_items": 0, "total_pages": 0 },
  "sort": { "by": "down_at", "order": "desc" }
}
```

Example 400 response for `date_from >= date_to_exclusive`:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_DATE_RANGE",
    "message": "date_from must precede date_to_exclusive",
    "fields": ["date_from", "date_to_exclusive"]
  }
}
```

Example 410 response:

```json
{
  "success": false,
  "error": {
    "code": "SNAPSHOT_EXPIRED",
    "message": "Snapshot expired; refresh the complete view",
    "fields": ["snapshot_token"]
  }
}
```

Unexpected errors return a generic 500 `INTERNAL_ERROR` without a stack trace. Integer overflow is an error, not rounded JSON data. No new rate limiter was added.

## Validation and deployment

- `npm test` (Windows PowerShell: `npm.cmd test`) runs isolated SQLite contract tests and HTTP routing regression tests. These cover the calculation fixture, filters, snapshot edits/inserts/expiry/scope, paging, numeric sort/null ties, corrupted records, soft deletion, unknown/future coverage, leap day/month boundaries, selectors, validation, migration rollback, and batch boundaries above 1,000 incidents.
- `node scripts/check-downtime-history-mysql.js` checks real MySQL SQL behavior using connection-local temporary copies of configured source tables. It tests consistency, buckets, exact province filtering, numeric sort, and frozen records after modifying only temporary source copies. It requires permission to create temporary tables, writes no persistent database schema/data, and produces [downtime-history-performance.json](downtime-history-performance.json). It does not start monitoring, send notifications, or run application cron jobs.
- The captured configured-database dataset contained 672 incidents and 180 distinct device IDs. See the JSON artifact for measured timings and EXPLAIN plans. This is a single-run check, not a concurrent load test. Source batching and snapshot-scoped pages use PRIMARY indexes; the page sort uses filesort at this scale. No speculative indexes were added to source tables.
- Before enabling the routes on a deployed database, apply migration `20260924100000-create-downtime-query-snapshots.js` through the normal release process. The migration creates only the two cache tables. Rollback drops those cache tables; remove/roll back the v2 routes first. The existing source schema is untouched.
- On 2026-09-24, after user authorization, migration `20260924100000-create-downtime-query-snapshots.js` was applied successfully to the configured **development** database; migration status is `up`. No other migrations were pending. The already-running API on local port 3000 served the new routes without a restart. Live HTTP checks passed for selectors, shared-snapshot summary/incidents/dashboard consistency (672 matched incidents, 365 daily and 12 monthly buckets), legacy summary, and invalid-query HTTP 400. This does not establish migration/deployment status for any other environment.
