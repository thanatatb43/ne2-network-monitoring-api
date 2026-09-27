# Backend response — REMAINING_UX_UI_BACKEND_API_SPEC.md

วันที่: 27 กันยายน 2026 · ตอบกลับ section 11 ของสเปค

| รหัส | สถานะ |
|---|---|
| **B1** | ✅ ทำแล้ว — `q` บน `GET /api/budgets/transactions` |
| **B2** | ✅ ทำแล้ว — `q` บน `GET /api/budgets/transactions/aggregates` + `coverage.amount_without_posting_date` |
| **B3** | ✅ ยืนยัน mapping — ไม่มีการเปลี่ยน shape |
| **N1** | 📋 ตอบ contract ของเดิม + เสนอ field เพิ่ม — **ยังไม่ได้แก้โค้ด** รอยืนยัน |
| **L1** | 📋 ตอบ semantics ของเดิม — แนะนำยังไม่ต้องทำ L2 |
| L2 / E1 / X1 | ⏸ ไม่ได้ทำในรอบนี้ ตามที่สเปคระบุ |

**Deployment:** ไม่มี migration ใหม่ ไม่ต้อง restart เพิ่ม (nodemon reload) · ทดสอบบน environment development กับฐานข้อมูลจริง 6,178 ธุรกรรม

**วิธีตรวจว่า B1/B2 deploy แล้ว:** ทุก response ของ `/transactions` และ `/transactions/aggregates` มี `meta.search.version = "literal-v1"` เสมอ (ไม่ว่าจะส่ง `q` หรือไม่) — ให้ frontend เช็ค field นี้ก่อนเลิก fallback ค้นทุกหน้าใน browser อย่าใช้ HTTP 200 เป็นตัวบอก

---

## B1 — `q` บน `GET /api/budgets/transactions`

### Semantics (`literal-v1`)

- trim หัวท้าย; ว่าง/มีแต่ช่องว่าง = ไม่กรอง (ไม่ error)
- ไม่เกิน 200 Unicode code points (นับแบบ code point ไม่ใช่ UTF-16 unit — อักษรไทย 1 ตัว = 1)
- ข้อความทั้งก้อนเป็น **literal substring ไม่แยกตัวพิมพ์** ไม่แยกคำ ไม่ใช่ regex
- `%` `_` `\` เป็นตัวอักษรจริง (escape ฝั่ง server แล้ว ส่งเป็น bound parameter)
- ค่า NULL ไม่เคยตรงกับคำค้นใดๆ — พิมพ์ `null` ไม่เจอ field ที่ว่าง
- AND กับ filter รายฟิลด์เดิมทุกตัว — `q` ไม่ล้าง `account_code`/`fiscal_year`/`posting_month` ฯลฯ
- กรองที่ SQL ก่อน COUNT / ORDER BY / LIMIT-OFFSET — ครอบคลุมทุก record ไม่ใช่แค่หน้าที่โหลด

### Fields ที่ค้น (OR กัน) — mapping จริง

| Field ใน response | Column จริง | รูปแบบที่ค้นได้ |
|---|---|---|
| `transaction_id` | `id` | เลขฐาน 10 เช่น `1205` |
| `reference_doc_no` | `reference_doc_no` | ข้อความ |
| `description` | `description` | ข้อความ |
| `account_code` / `cost_center` | `cost_center` | column เดียวกัน ค้นครั้งเดียว |
| `account_name` / `cost_center_name` | `cost_center_name` | column เดียวกัน ค้นครั้งเดียว |
| `clearing_account_code` | `clearing_account` | ข้อความ |
| `clearing_account_name` | `clearing_account_name` | ข้อความ |
| `username` | `username` | ข้อความ |
| `fiscal_year` | `year` | เช่น `2025` |
| `document_date` | `document_date` | ISO `YYYY-MM-DD` |
| `posting_date` / `posting_month` | `posting_date` | ISO `YYYY-MM-DD` หรือ `YYYY-MM` (prefix เดียวกัน) |
| `amount` | `value_co_curr` | canonical decimal เช่น `-21800.00`, `5400` — ไม่มี comma/สัญลักษณ์บาท |
| `amount_direction` | *derived* จากเครื่องหมาย | `debit` = amount ≥ 0, `credit` = amount < 0 |
| `currency` | *derived* (ค่าคงที่) | `THB` — ทุกรายการ ดังนั้น `q=thb` หรือ `q=h` ตรงทุกแถว |

**ไม่ค้น:** `linked_job_count`, metadata, pagination

**ข้อสังเกตที่ frontend ควรรู้** — เพราะ `amount_direction`/`currency` เป็นคำภาษาอังกฤษสั้นๆ คำค้นตัวอักษรเดียวอย่าง `e`, `d`, `t` จะตรงทุกแถวที่เป็น debit/credit หรือทุกแถว (ผ่าน `THB`) นี่เป็นผลที่ถูกต้องตามนิยาม literal-v1 ไม่ใช่ bug

### การเรียงลำดับ

- whitelist เดิม ไม่เปลี่ยน; `amount` เรียงแบบตัวเลข decimal (ไม่ใช่ string)
- **NULL อยู่ท้ายเสมอ ทั้ง asc และ desc** (เพิ่มในรอบนี้ — ก่อนหน้านี้ใช้ค่า default ของ MySQL ที่ NULL สลับฝั่งเมื่อกดเปลี่ยนทิศ)
- tie-breaker `id DESC` คงที่

### เปลี่ยนจากเดิม (additive ทั้งหมด)

- `meta.applied_filters` และ `meta.search` — เพิ่มใหม่
- `applied_filters` ระดับบนสุด — **ยังคงอยู่** สำหรับ caller เดิม
- `pagination.total_pages` เมื่อไม่พบ = **`0`** (เดิมเป็น `1`) ตามที่สเปคข้อ 3 กำหนด — frontend ที่เคยพึ่งค่า `1` ต้องปรับ

### ตัวอย่าง

**Success** — `GET /api/budgets/transactions?q=Fiber&page_size=10`
```json
{
  "success": true,
  "data": [{
    "transaction_id": "1205", "fiscal_year": 2025,
    "document_date": "2025-01-27", "posting_date": "2025-01-27", "posting_month": "2025-01",
    "reference_doc_no": "2000095262",
    "description": "ค่า Fiber Media ติดตั้งใช้งานที่ กฟส.รอ.",
    "account_code": "53032070", "account_name": "ค่าInst.Equipสื่อสาร",
    "cost_center": "53032070", "cost_center_name": "ค่าInst.Equipสื่อสาร",
    "clearing_account_code": "240701", "clearing_account_name": "บริษัท สเต็ปอัพ เทเลคอม จำกัด",
    "username": "E2DCTXX01", "amount": "5400.00", "amount_direction": "debit",
    "currency": "THB", "linked_job_count": 0
  }],
  "pagination": { "page": 1, "page_size": 10, "total_items": 176, "total_pages": 18 },
  "applied_filters": { "q": "Fiber" },
  "meta": {
    "generated_at": "2026-09-27T...Z", "currency": "THB",
    "applied_filters": { "q": "Fiber" },
    "search": { "version": "literal-v1", "scope": "all_filtered_records" }
  }
}
```

**Empty** — `q=NE2_API_AUDIT_NO_MATCH_20260927_XYZ` → `200`, `data: []`, `total_items: 0`, `total_pages: 0`

**Error** — `q` ยาว 201 code points → `400`
```json
{ "success": false,
  "error": { "code": "INVALID_QUERY", "message": "q must not exceed 200 characters", "fields": { "q": "Too long" } },
  "request_id": "req_..." }
```

---

## B2 — `q` บน `GET /api/budgets/transactions/aggregates`

ใช้ `parseCommonFilters()` ตัวเดียวกับ B1 — `q` และทุก filter ผ่าน predicate เดียวกัน ทั้ง totals และทุก month bucket

- `q` ไม่พบ → totals `0.00`/count `0` และถ้ามี `fiscal_year` ยังคืนครบ 12 เดือนเป็นศูนย์ **ไม่ fallback เป็นยอดทั้งปี**
- **เพิ่ม** `coverage.amount_without_posting_date` (decimal string)
- เงินทุกจุดเป็น decimal string 2 ตำแหน่ง — ผลรวมจาก MySQL `SUM(DECIMAL)` ถูก format ด้วย string manipulation ไม่ผ่าน JS float
- credit เป็นค่าลบ ไม่ใช้ abs

Invariants ที่ทดสอบแล้ว (ดูผลด้านล่าง):
```text
transactions.pagination.total_items = aggregates.totals.transaction_count
SUM(amount ทุกหน้า)                  = aggregates.totals.net
totals.debit + totals.credit          = totals.net
SUM(by_month.net)   + coverage.amount_without_posting_date  = totals.net
SUM(by_month.count) + coverage.records_without_posting_date = totals.transaction_count
```

### Consistency model

`/transactions` และ `/aggregates` เป็นสอง request แยก query แยก **ไม่มี snapshot ร่วม** — invariants ข้างบนรับประกันเฉพาะเมื่อข้อมูลไม่เปลี่ยนระหว่างสอง request

จุดที่ข้อมูลเปลี่ยนได้มีจุดเดียวคือ `POST /api/budgets/upload-transactions` ซึ่ง **ลบแล้ว insert ใหม่ทั้งชุดของ (cost_center, year) นั้น** — ถ้า upload เกิดระหว่าง frontend โหลดรายการกับยอด ตัวเลขอาจไม่ตรงชั่วคราว (และ `transaction_id` ของชุดนั้นเปลี่ยนทั้งหมดด้วย เพราะเป็น insert ใหม่) รอบนี้ไม่ได้สร้าง dataset revision/token ตามที่สเปคบอกว่าไม่ต้องทำ — ถ้าต้องการรับประกันระหว่างการนำเข้าจริง ต้องเป็นงานแยก

---

## B3 — Mapping ผู้เรียกเดิม

| Consumer เดิม (`POST /transactions/find`, legacy) | Canonical (endpoint ใหม่) | หมายเหตุ |
|---|---|---|
| `id` | `transaction_id` | เป็น string ใน endpoint ใหม่ — **เปลี่ยนเมื่อ upload ซ้ำ** (ดู consistency model) |
| `year` | `fiscal_year` | ปีปฏิทิน ม.ค.–ธ.ค. |
| `value_co_curr` | `amount` | decimal string, เครื่องหมายเดิม |
| `cost_center` | `account_code` | column เดียวกัน |
| `cost_center_name` | `account_name` | column เดียวกัน |
| `clearing_account` | `clearing_account_code` | |
| `document_date` / `posting_date` | เหมือนเดิม | ⚠️ **legacy คืน `DD.MM.YYYY`** (model getter) endpoint ใหม่คืน ISO `YYYY-MM-DD` — adapter ต้องแปลง |
| `count` | `pagination.total_items` | |
| `summary.by_month[].spent / not_spent` | `aggregates.by_month[].debit / credit` | ⚠️ legacy `not_spent` เป็น **ค่าบวก (abs)** ส่วน `credit` ใหม่เป็น **ค่าลบ** |
| `createdAt`, `updatedAt`, `deletedAt` | ไม่มี | เวลานำเข้า ไม่ใช่ข้อมูลบัญชี |

- `POST /transactions/find` **ไม่เปลี่ยน** — regression test ผ่าน
- `linked_job_count` = 0 เสมอ เพราะ **ไม่มีตาราง link** ระหว่างธุรกรรมกับงาน ห้ามแสดงเป็นหลักฐานว่า "ไม่มีงานที่เกี่ยวข้อง"

### `q` สองตัวที่ชื่อเหมือนกันแต่ความหมายต่างกัน

| Endpoint | `q` หมายถึง |
|---|---|
| `/transactions`, `/transactions/aggregates` | ค้นธุรกรรม (literal-v1 ข้ามทุก field ข้างบน) |
| `/transactions/selectors?field=...&q=...` | ค้น **ตัวเลือก** ของ field เดียวที่ระบุ — substring บน column ของ field นั้นเท่านั้น ไม่ได้ผ่าน literal-v1 escaping |

### ตัวอย่าง detail และ selectors

- `GET /transactions/1205` → `200` data เหมือน 1 แถวของ list
- `GET /transactions/999999999` → `404` `{ "error": { "code": "TRANSACTION_NOT_FOUND" } }`
- `GET /transactions/abc` → `400` `INVALID_QUERY`
- `GET /transactions/selectors` (ไม่ส่ง field) → shape legacy: `{ data: { cost_center: [...], username: [...], ... } }`
- `GET /transactions/selectors?field=username&q=E2DC&limit=5` → `{ data: { field: "username", options: [{ "value": "E2DCTXX01", "label": "E2DCTXX01" }, ...] } }`

---

## Contract test results — B1/B2 (63/63 ผ่าน)

รันแบบ read-only กับ server จริง script อยู่นอก repo (scratchpad) — ขอได้ถ้าต้องการใส่ CI

| # สเปค | ผล |
|---|---|
| 1 | ✅ คำค้นสุ่มไม่พบ → `200`, `[]`, total `0`, total_pages `0`; empty/whitespace q = ไม่ส่ง (6178/6178/6178) |
| 2 | ✅ `fiber`=`FIBER` (176/176), ไทย `สาย` (225), `%`→0 แถว, `_`→1 แถว (มี `_` จริง), `\`→0, `null`→0, `-21800` เจอ, `2025-01-27` เจอ, `2025-01` เจอ |
| 3 | ✅ q + account_code / fiscal_year / posting_month เป็น AND ทุกแถว |
| 4 | ✅ ไล่ทุกหน้า ไม่ซ้ำ/ไม่หาย; amount asc เรียงเชิงตัวเลข; หน้าเกินขอบ → `[]` + total จริง |
| 5 | ✅ total = count และ SUM(amount ทุกหน้า) = net **ตรงระดับสตางค์** (คำนวณเป็น integer cents) ทั้ง 4 ชุด: `q=สาย` (225 แถว), `q=สาย`+2025 (99), `q=e` (6178), ไม่มี q+2025 (1879) |
| 6 | ⚠️ ผ่านแบบ trivial — **ข้อมูลจริงไม่มีแถวที่ `posting_date` เป็น NULL เลย** จึงยังไม่ได้ทดสอบกรณีที่ monthly ≠ totals จริง ต้องใช้ fixture ที่มีแถวแบบนั้น |
| 7 | ✅ q ไม่พบ + fiscal_year → 12 เดือนเป็นศูนย์ ไม่คืนยอดทั้งปี |
| 8 | ✅ 200 code points ผ่าน, 201 → `400` ทั้งสอง endpoint; page_size/sort ผิด → `400` |
| 9 | ✅ `/summary/:year`, `/dashboard/summary`, selectors ทั้งสองโหมด, detail 200/404, `POST /find` — shape เดิม ไม่ได้แตะ upload/CRUD |

### Performance (dataset จริง 6,178 แถว, worst of 5, localhost)

| Request | เวลา |
|---|---|
| `/transactions` q ไม่พบ / q แคบ (`สาย`) / q กว้าง (`e`) / q กว้าง + sort amount | 64 / 59 / 34 / 57 ms |
| `/aggregates` q แคบ / q กว้าง / fiscal_year อย่างเดียว | 117 / 73 / 22 ms |

⚠️ **ข้อจำกัดที่ต้องรู้:** `q` เป็น `LIKE '%...%'` บน `LOWER(CAST(...))` — **ใช้ index ไม่ได้ ต้อง scan ทุกแถว** ที่ผ่าน filter อื่น เวลาจึงโตตามจำนวนแถวแบบเส้นตรง ตัวเลขข้างบนต่ำเพราะข้อมูลยังเล็ก ไม่ใช่เพราะ query เร็วโดยธรรมชาติ ถ้าข้อมูลโตหลักแสนแถวควรวัดใหม่ และพิจารณา FULLTEXT index (ซึ่งจะเปลี่ยน semantics จาก literal substring เป็นการค้นคำ — ต้องออกเป็น version ใหม่)

---

## N1 — สถานะอุปกรณ์และเวลา (ตอบ contract ของเดิม)

**ไม่ได้แก้โค้ด N1 ในรอบนี้** — สเปคขอให้ยืนยันก่อน ด้านล่างคือพฤติกรรมจริงจากการอ่านโค้ดและข้อมูล

### ⚠️ path ในสเปคไม่ตรงของจริง

สเปคเขียน `POST /api/latency/check/:deviceId` — **ของจริงคือ `GET /api/latency/check/:id`**

### ภาพรวมแหล่งข้อมูล

ทุก endpoint ยกเว้น `check-ip` อ่านจากตาราง `DeviceMetrics` ซึ่งมี **1 แถวต่ออุปกรณ์** (ยืนยันแล้วไม่มีแถวซ้ำ) ถูกเขียนทับโดย 2 แหล่ง:
1. **ping loop พื้นหลัง** (`pingService.js`) — 10 เครื่อง/batch พัก 60 วิ, รอบเต็มประมาณ 20 นาที, **หยุดทำงาน 00:00–05:00** ทุกคืน
2. **`GET /api/latency/check/:id`** — เมื่อมีคนกดตรวจเอง

**`status` มีแค่ 2 ค่า `up` / `down`** ไม่มี `unknown` และ**ไม่มี field `alive`** ใน DeviceMetrics

| Endpoint | ตอบคำถามในสเปค |
|---|---|
| `GET /latency/metrics` | อ้าง `device_id` (มี `id` ของแถว metric ด้วย อย่าสับสน) · มี `status` ไม่มี `alive` · `checked_at` = เวลาวัด (ดูหมายเหตุ) · `latency_ms`, `packet_loss`, `client_id`, `createdAt`, `updatedAt` + `device.{pea_name,pea_type,province,gateway}` · กรองอุปกรณ์ที่ถูก soft-delete ออก (inner join) |
| `GET /latency/down` | ผลล่าสุดของแต่ละเครื่องเท่านั้น ไม่มีประวัติปน · **ไม่มี freshness cutoff** — เครื่องที่ไม่ถูกตรวจนานก็ยังนับ down ต่อไปเรื่อยๆ · `[]` คืนเฉพาะ query สำเร็จ, database error ไปที่ error handler → `500` |
| `GET /latency/check/:id` | **sync** รอ ping เสร็จก่อนตอบ (สูงสุด ~10 วิ: gateway + fallback WAN) · ไม่มี retry · shape: `{ data: { device_id, pea_name, gateway, status, latency_ms, packet_loss, checked_at } }` · 404 ถ้าไม่พบเครื่องหรือไม่มี gateway · **มีผลข้างเคียง** (ดูด้านล่าง) |
| `GET /test/check-ip/:ip` | probe สดจาก API server (timeout 3 วิ, 3 packets) · **ไม่เขียน DB** · `alive` เป็น boolean เสมอ ไม่เคย null · field อยู่ระดับบนสุด ไม่ได้ห่อใน `data` · 400 ถ้า IP ไม่ถูกรูปแบบ, 500 ถ้า ping ล้มเหลว |

### ปัญหาที่พบระหว่างตรวจ — ควรรู้ก่อนเชื่อม frontend

1. **`GET /latency/check/:id` เป็น GET แต่เขียนข้อมูล** — upsert `DeviceMetrics` ทับผล ping loop และ**ส่งแจ้งเตือน Teams + สร้าง/ปิด DeviceDowntime** ถ้าสถานะเปลี่ยน การเปิด URL นี้ซ้ำ (prefetch, retry ของ browser, crawler) จึงเปลี่ยนสถานะ monitoring และยิงแจ้งเตือนได้ อีกทั้ง**ไม่มี retry** ต่างจาก ping loop ที่มี — กดตรวจเองตอนเครือข่ายสะดุดครั้งเดียวจะบันทึก down + แจ้งเตือนทันที
2. **`packet_loss` ถูกบังคับเป็น `100` ทุกครั้งที่ `alive=false`** (ทั้ง `check` และ `check-ip`) — ค่าจริงอาจเป็น 33% (เคยวัดได้ใน session ก่อน) ข้อมูลจึงบอกไม่ได้ว่า "ไม่ตอบเลย" กับ "ตอบบางส่วน" ต่างกัน
3. **`checked_at` ของ ping loop คือเวลาเริ่ม batch** ไม่ใช่เวลาที่ probe เครื่องนั้นจริง — เร็วกว่าเวลาวัดจริงได้ถึง ~30 วิ (probe + retry) ส่วน `check` และ `check-ip` ใช้เวลาหลัง probe เสร็จ
4. **ไม่มีการบอก probe source** — ถ้า gateway ไม่ตอบแต่ FortiGate WAN ตอบ จะรายงาน `up` พร้อม latency ของ WAN โดยไม่บอกว่าวัดจาก IP ไหน
5. **ข้อมูลค้างข้ามคืน** — ping loop หยุด 00:00–05:00 ช่วงนั้น `/metrics` และ `/down` คืนผลเก่าสุด 5 ชม. โดยไม่มีสัญญาณบอก
6. **error ของ `check-ip` รั่ว `error.message`** และ error อื่นผ่าน global handler ที่ **แนบ stack trace เมื่อ `NODE_ENV` ไม่ใช่ `production`**
7. **"unknown" ไม่มีอยู่จริง** — ไม่มีสถานะแยกสำหรับ "ยังไม่เคยวัด" หรือ "ข้อมูลเก่าเกินไป"

### ข้อเสนอ additive (ยังไม่ทำ — รอยืนยัน)

เติม field ต่อไปนี้ใน `/metrics`, `/down`, `/check/:id` โดยไม่ลบ field เดิม:

| Field | ที่มา |
|---|---|
| `alive` | `true`/`false` จาก `status`; `null` เมื่อ stale |
| `live_status` | `up` / `down` / `unknown` — `unknown` เมื่อ `checked_at` เก่ากว่า threshold |
| `probe_source` | `background_loop` / `on_demand_check` — ต้องเพิ่ม column |
| `probed_ip` | `gateway` / `wan_ip_fgt` — ต้องเพิ่ม column |
| `meta.stale_after_seconds` | threshold ที่ตกลงกัน — **ต้องให้เจ้าของระบบกำหนด** (ผมไม่ได้กำหนดเองตามที่สเปคห้าม) ข้อเสนอเริ่มต้นคิดจากรอบ loop ≈ 20 นาที และช่วงหยุดกลางคืน |

แยกเป็นงานต่างหาก (ไม่ใช่ additive): ย้าย `check/:id` เป็น `POST`, เก็บ `packet_loss` จริงแทน 100, ใช้เวลา probe จริงเป็น `checked_at`

---

## L1 — ประวัติยืม (ตอบ semantics ของเดิม)

`GET /api/office-equipment/loans?page=&limit=&status=&equipment_id=&pea_site_id=&search=`

| คำถาม | คำตอบ |
|---|---|
| page/limit นับอะไร | **นับ loan row (รายชิ้น) ไม่ใช่ batch** — `limit` default 20 ไม่มีเพดานสูงสุด |
| sort / tie-break | `borrowed_at DESC, id DESC` |
| `total` / `totalPages` | จำนวน loan row ที่ผ่าน filter / `ceil(total/limit)` |
| batch ข้ามหน้าได้ไหม | **ได้** — แถวใน batch เดียวกันมี `borrowed_at` เท่ากันจึงอยู่ติดกัน แต่ขอบหน้าตัดกลาง batch ได้ |
| `batch_id` มีทุก loan ไหม | **ไม่** — ข้อมูลจริง 7 จาก 13 loan เป็น `null` (สร้างก่อนมี batch) ยืมทีละชิ้นหลังจากนั้นได้ batch ของตัวเอง (batch of one) |
| `search` ค้นอะไร | `borrower_name`, `borrower_emp_id`, `borrower_contact` เท่านั้น — **ไม่ค้นชื่ออุปกรณ์/รหัสทรัพย์สิน** · ค้นก่อนแบ่งหน้า |
| `status` | `open` = ยังไม่คืน, `returned` = คืนแล้ว, ค่าอื่น = ไม่กรอง |
| สิทธิ์ | อ่าน **public** ไม่ต้อง login · ยืม/คืนต้อง login (role ใดก็ได้) |
| เวลา | `borrowed_at`, `returned_at`, `due_date` เป็น DATETIME คืนเป็น ISO UTC |
| อุปกรณ์ถูกลบ | `equipment` ใน response เป็น `null` (soft delete ถูกกรองออก) — ข้อมูลจริงตอนนี้ไม่มีเคสนี้ |

**ข้อแนะนำ: ยังไม่ต้องทำ L2** — ข้อมูลจริงมี 13 loan, มี batch หลายชิ้นแค่ 1 batch (3 ชิ้น) ความเสี่ยงที่ batch ข้ามหน้าต่ำมาก ให้ UI แสดง batch บางส่วนพร้อมคำอธิบายไปก่อน ถ้าต้องการกัน batch ถูกตัดโดยไม่ต้องทำ L2 ทางเลือกถูกกว่าคือ **เปลี่ยน pagination ให้นับเป็น batch** ใน endpoint เดิม (breaking — ต้องออก version)

⚠️ ถ้าจะให้ `search` ค้นชื่ออุปกรณ์ด้วย ต้องแก้ endpoint เดิม (additive) — แจ้งได้
