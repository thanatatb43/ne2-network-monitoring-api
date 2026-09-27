# Backend response — REMAINING_UX_UI_BACKEND_API_SPEC.md

วันที่: 27 กันยายน 2026 · ตอบกลับ section 11 ของสเปค · **ปรับปรุงรอบ 2** (ดูแถบ "รอบ 2" ด้านล่าง)

| รหัส | สถานะ |
|---|---|
| **B1** | ✅ ทำแล้ว — `q` บน `GET /api/budgets/transactions` |
| **B2** | ✅ ทำแล้ว — `q` บน `GET /api/budgets/transactions/aggregates` + `coverage.amount_without_posting_date` · **รอบ 2: พิสูจน์กรณี `posting_date = NULL` ด้วย fixture แล้ว** |
| **B3** | ✅ ยืนยัน mapping — ไม่มีการเปลี่ยน shape |
| **N1** | ✅ **รอบ 2: ทำแล้ว** — กติกาข้อมูลเก่า + ลำดับ `live_status`/`alive`/`status`, check ย้ายเป็น POST (GET deprecated), แก้ packet loss และเวลาวัด |
| **L1** | 📋 ตอบ semantics ของเดิม — แนะนำยังไม่ต้องทำ L2 |
| L2 / E1 / X1 | ⏸ ไม่ได้ทำในรอบนี้ ตามที่สเปคระบุ |

**Deployment:** ไม่มี migration ใหม่ ไม่ต้อง restart เพิ่ม (nodemon reload) · env ใหม่ (ไม่บังคับ): `DEVICE_STATUS_STALE_SECONDS` ค่าเริ่มต้น `2700` · ทดสอบบน environment development กับฐานข้อมูลจริง 6,178 ธุรกรรม / 197 อุปกรณ์

> **รอบ 2 — แก้ข้อความที่ผิดในรอบแรก:** รอบแรกเขียนว่า "`packet_loss` ถูกบังคับเป็น 100 ทุกครั้งที่ `alive=false` ... ค่าจริงอาจเป็น 33%" — **ข้อนี้ผิด** เมื่ออ่าน parser ของ library แล้วพบว่า `alive=false` แปลว่าไม่มี echo reply จริงสักตัว 100% จึงถูกต้องมาตลอด ส่วน 33% คือ Windows นับ "Destination host unreachable" จาก router เป็นการได้รับ ปัญหาจริงอยู่อีกฝั่งคือตอน `alive=true` ดูรายละเอียดที่ N1 ด้านล่าง

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
| 6 | ✅ **รอบ 2: พิสูจน์ด้วย fixture แล้ว** (ข้อมูลจริงไม่มีแถว `posting_date = NULL` เลย) — ดู "Fixture: posting_date = NULL" ด้านล่าง |
| 7 | ✅ q ไม่พบ + fiscal_year → 12 เดือนเป็นศูนย์ ไม่คืนยอดทั้งปี |
| 8 | ✅ 200 code points ผ่าน, 201 → `400` ทั้งสอง endpoint; page_size/sort ผิด → `400` |
| 9 | ✅ `/summary/:year`, `/dashboard/summary`, selectors ทั้งสองโหมด, detail 200/404, `POST /find` — shape เดิม ไม่ได้แตะ upload/CRUD |

### Fixture: `posting_date = NULL` (รอบ 2) — 31/31 ผ่าน

`node scripts/check-budget-coverage-mysql.js` — **ไม่เขียนข้อมูลถาวร:** ใน connection เดียวของ pool ขนาด 1 สร้าง `TEMPORARY TABLE BudgetTransactions` บังตารางจริงเฉพาะ connection นั้น แล้วเรียก controller ตัวจริงบน connection เดียวกัน (แนวเดียวกับ `scripts/check-downtime-history-mysql.js`) ยืนยันแล้วว่าตารางจริงนับได้ 6178 / ยอด 17,170,768.10 เท่าเดิมทั้งก่อนและหลังรัน

Fixture 9 แถว: 3 แถว `posting_date = NULL` (มีทั้งบวกและลบ ต่างบัญชี), 1 แถว `document_date`/`description` เป็น NULL, 1 แถวปีอื่นที่ไม่ทราบเดือน **ค่าคาดหวังคำนวณด้วยมือจาก fixture ไม่ได้ให้โค้ดที่ทดสอบคำนวณเอง** และยอดเงินตรวจเป็นหน่วยสตางค์ (integer)

| กรณี | ผล |
|---|---|
| `fiscal_year=2026` | count 8, debit 2845.77, credit -275.30, net 2570.47 ตรงเป๊ะ · coverage 3 แถว / 437.09 · **monthly ≠ totals จริง** (script ยืนยันว่าต่างกันจริง ไม่ใช่ผ่านเพราะเท่ากันอยู่แล้ว) และ `SUM(by_month) + coverage = totals` |
| แถวไม่ทราบเดือนในรายการ | ได้ `posting_date` และ `posting_month` เป็น `null` · เรียง `posting_date` ทั้ง asc/desc → NULL อยู่ท้ายสุด |
| `q` ที่ตรงเฉพาะแถวไม่ทราบเดือน | ยอดทั้งหมดไปอยู่ใน coverage ทุกเดือนเป็นศูนย์ |
| `account_code` | แยกยอดไม่ทราบเดือนตามบัญชีถูกต้อง (2 แถว / 424.75) |
| `posting_month`, `date_from`/`date_to` | แถวไม่ทราบเดือน**ไม่ถูกนับ** (ไม่มีวันที่ให้อยู่ในช่วง) coverage = 0 |
| แถวปี 2025 ที่ไม่ทราบเดือน | ไม่รั่วเข้าผล 2026 |
| `q=null` | ไม่เจอแถวที่ field เป็น NULL |

**นิยามที่ยืนยันจาก fixture:** แถวไม่ทราบเดือนนับใน `totals` เสมอ แต่ไม่อยู่ใน bucket เดือนใด และ **filter ใดๆ ที่อิงวันที่จะตัดแถวเหล่านี้ออก**

### Performance (dataset จริง 6,178 แถว, worst of 5, localhost)

| Request | เวลา |
|---|---|
| `/transactions` q ไม่พบ / q แคบ (`สาย`) / q กว้าง (`e`) / q กว้าง + sort amount | 64 / 59 / 34 / 57 ms |
| `/aggregates` q แคบ / q กว้าง / fiscal_year อย่างเดียว | 117 / 73 / 22 ms |

⚠️ **ข้อจำกัดที่ต้องรู้:** `q` เป็น `LIKE '%...%'` บน `LOWER(CAST(...))` — **ใช้ index ไม่ได้ ต้อง scan ทุกแถว** ที่ผ่าน filter อื่น เวลาจึงโตตามจำนวนแถวแบบเส้นตรง ตัวเลขข้างบนต่ำเพราะข้อมูลยังเล็ก ไม่ใช่เพราะ query เร็วโดยธรรมชาติ ถ้าข้อมูลโตหลักแสนแถวควรวัดใหม่ และพิจารณา FULLTEXT index (ซึ่งจะเปลี่ยน semantics จาก literal substring เป็นการค้นคำ — ต้องออกเป็น version ใหม่)

---

## N1 — สถานะอุปกรณ์และเวลา (รอบ 2: ทำแล้ว)

### ⚠️ path ในสเปคไม่ตรงของจริง

สเปคเขียน `POST /api/latency/check/:deviceId` — ของเดิมคือ `GET /api/latency/check/:id` รอบ 2 **เพิ่ม `POST` เป็นทางหลัก** และคง `GET` ไว้แบบ deprecated (ดู "แผนแก้การตรวจอุปกรณ์")

### แหล่งข้อมูล

ทุก endpoint ยกเว้น `check-ip` และ `ping-check` อ่านจากตาราง `DeviceMetrics` ซึ่งมี **1 แถวต่ออุปกรณ์** (ยืนยันแล้วไม่มีแถวซ้ำ) เก็บ**ผลวัดครั้งล่าสุด** ถูกเขียนทับโดย 2 แหล่ง:
1. **ping loop พื้นหลัง** — 10 เครื่อง/batch พัก 60 วิ, วนครบทุกเครื่องประมาณ 21.5 นาที, **หยุด 00:00–05:00**
2. **`POST`/`GET /api/latency/check/:id`** — เมื่อมีคนกดตรวจเอง

ทั้งสองแหล่งใช้โค้ด probe ตัวเดียวกันแล้ว (`src/services/deviceProbe.js`) — gateway → ถ้าไม่ตอบลอง FortiGate WAN → ถ้ายังไม่ตอบรอ 3 วิ แล้ว retry อีก 1 ครั้ง ก่อนสรุปว่า down

### กติกาข้อมูลเก่า (staleness)

ผลวัดที่เก่ากว่า **`stale_after_seconds` = 2700 วินาที (45 นาที)** ไม่ถือเป็นสถานะปัจจุบันอีกต่อไป

- **ที่มาของตัวเลข:** loop วนครบใช้ ~21.5 นาที (วัดจากระยะห่างของ `LatencyLogs` และกลุ่ม DeviceDowntime ที่กระจุกช่วง 21–29 นาที) — 45 นาทีคือ 2 รอบบวก margin ยอมให้พลาดได้ 1 รอบ
- **ปรับได้** ผ่าน env `DEVICE_STATUS_STALE_SECONDS` ถ้าจังหวะ loop เปลี่ยน (ค่าที่ไม่ใช่จำนวนเต็มบวกจะใช้ 2700)
- **ช่วง 00:00–05:00:** loop หยุด ทุกเครื่องจะกลายเป็น `unknown` ราว 00:45 เป็นต้นไปจนถึงรอบแรกหลัง 05:00 — **ถูกต้องตามนิยาม ไม่ใช่เหตุขัดข้อง** frontend ควรแสดงเป็น "ยังไม่มีผลวัดล่าสุด" ไม่ใช่ offline
- ตัวเลขนี้เจ้าของระบบยังเปลี่ยนได้ ผมตั้งจากจังหวะ loop ที่วัดได้จริง ไม่ได้ตั้งเพื่อให้ทุกเครื่องดูปกติ

### ลำดับการใช้ field

| ลำดับ | Field | ค่า | ใช้เมื่อ |
|---|---|---|---|
| **1** | `live_status` | `up` / `down` / `unknown` | **ตัวเดียวที่ใช้แสดง "สถานะปัจจุบัน"** |
| 2 | `alive` | `true` / `false` / `null` | boolean ของ `live_status` (`null` = unknown) — derive มาจาก `live_status` จึง**ขัดกันไม่ได้** |
| 3 | `status` | `up` / `down` | ผลวัดดิบครั้งล่าสุด คงไว้ให้ caller เดิม — **ห้ามแสดงเป็นสถานะปัจจุบันเดี่ยวๆ** ใช้ได้แค่ "วัดล่าสุด `<status>` เมื่อ `<checked_at>`" |

`live_status = unknown` เมื่อ: ไม่มีผลวัด / `checked_at` ว่างหรืออ่านไม่ได้ / เก่ากว่า threshold / `status` เป็นค่าที่ไม่รู้จัก

Field ประกอบ: `stale` (boolean), `age_seconds` (อายุผลวัด ณ ตอนตอบ, `null` ถ้าไม่มีผลวัด) — ทุก response มี `meta` บอก `stale_after_seconds`, `status_precedence`, `measured_at_field: "checked_at"`, `probe_paused_window`, `generated_at` (เวลาสร้าง response แยกจากเวลาวัด)

### เปลี่ยนแปลงราย endpoint (additive ทั้งหมด — field เดิมไม่เปลี่ยน)

| Endpoint | เพิ่ม |
|---|---|
| `GET /latency/metrics` | ทุกแถว: `live_status`, `alive`, `stale`, `age_seconds` · `meta` |
| `GET /latency/down` | ยังคืนทุกเครื่องที่**ผลวัดล่าสุด**เป็น down เหมือนเดิม แต่ทุกแถวมี field ข้างบน + `meta.currently_down`, `meta.stale_down` — เครื่อง down ที่ loop ไม่ได้ตรวจนานจะได้ `live_status: unknown` ไม่ใช่ `down` |
| `GET /latency/status-summary` | `online`/`offline` เดิม**นับผลเก่ารวมไปด้วย** (คงไว้) · เพิ่ม `live: { online, offline, unknown }` ที่นับเฉพาะผลที่ยังสด · `meta` |
| `POST`/`GET /latency/check/:id` | `live_status`, `alive` (วัดเดี๋ยวนั้นจึงสดเสมอ), `probed_ip` (`gateway` / `wan_ip_fgt`), `attempts` (1 หรือ 2) |

**ตัวอย่างจากการทดสอบจริง** — `POST /api/latency/check/1`:
```json
{ "success": true, "data": {
  "device_id": 1, "pea_name": "ผคข. (ทดสอบ)", "gateway": "172.21.223.158",
  "status": "up", "latency_ms": 17, "packet_loss": 0, "checked_at": "2026-09-27T11:16:02.482Z",
  "live_status": "up", "alive": true, "probed_ip": "wan_ip_fgt", "attempts": 1 } }
```
`probed_ip` เผยสิ่งที่เดิมมองไม่เห็นทันที: **gateway ของเครื่องนี้ไม่ตอบ** แต่ถูกรายงานว่า up เพราะ WAN ตอบแทน (และเป็นเหตุที่เครื่องนี้ถูกวัดช้ากว่าเครื่องอื่นใน batch 7 วินาที)

### แผนแก้การตรวจอุปกรณ์ — ยืนยันปัญหาและขั้นตอน

**ยืนยันปัญหา (อ่านจากโค้ดและทดสอบแล้ว):** `GET /api/latency/check/:id` (1) upsert `DeviceMetrics` ทับผลของ loop, (2) ถ้าสถานะเปลี่ยนจะเรียก `sendTeamsNotification` ซึ่ง**ส่ง Teams และสร้าง/ปิด `DeviceDowntime`**, (3) ไม่ต้อง login, (4) เดิม**ไม่มี retry** — การเปิด URL ซ้ำ (prefetch/retry ของ browser/crawler) จึงเปลี่ยนสถานะ monitoring และยิงแจ้งเตือนได้

| ระยะ | สถานะ | งาน |
|---|---|---|
| **1** | ✅ **ทำแล้ว** | เพิ่ม `POST /api/latency/check/:id` (handler เดียวกัน) · `GET` ยังทำงานเหมือนเดิมแต่ตอบ header `Deprecation: true` + `Link: </api/latency/check/:id>; rel="successor-version"` + `meta.deprecations` · ใช้ probe ร่วมกับ loop จึง**มี retry แล้ว** ลดการแจ้งเตือนผิดจากการกดตรวจตอนเครือข่ายสะดุดครั้งเดียว |
| **2** | ⏳ frontend | ย้ายทุกจุดที่เรียกเป็น `POST` — ตรวจได้จาก log ว่ายังมี GET เข้ามาหรือไม่ |
| **3** | ⏳ รอตัดสินใจ | หลังไม่มีผู้เรียก GET แล้ว: เอา `GET` ออก (หรือทำเป็นอ่านอย่างเดียวไม่เขียน/ไม่แจ้งเตือน) |
| **4** | ⏳ รอตัดสินใจ | ให้ `POST` ต้อง login — **จะทำให้ผู้ใช้ที่ไม่ login กดตรวจไม่ได้** จึงต้องให้เจ้าของระบบตัดสิน ไม่ได้ทำเองในรอบนี้ |

ยังไม่มี cooldown ต่อเครื่อง: การกด POST ถี่ๆ ขณะเครื่องขึ้นๆ ลงๆ ยังส่งแจ้งเตือนได้ทุกครั้งที่สถานะเปลี่ยน (retry ช่วยได้บางส่วน)

### แก้ packet loss (แยกเป็นเรื่องที่ 1)

- **ต้นเหตุ:** `packetLoss` ของ library ถูก parse จากบรรทัดสรุปของ Windows ซึ่ง**นับ "Destination host unreachable" จาก router เป็นการได้รับ** ส่วน `alive` มาจาก `times` ที่นับเฉพาะ echo reply จริง (บรรทัดที่มี `bytes=`/`time=`/`TTL=`)
- **ผลต่อข้อมูลเดิม:**
  - `alive=false` → โค้ดเดิมบังคับเป็น 100 ซึ่ง**ถูกต้องอยู่แล้ว** (ไม่มี echo reply จริงเลย) — ข้อความรอบแรกที่ว่าผิดจึงเป็นการวินิจฉัยผิดของผมเอง
  - `alive=true` → โค้ดเดิมใช้ค่าของ Windows ซึ่ง**ต่ำกว่าความจริงได้** เช่น ตอบจริง 2 ใน 3 + unreachable 1 → Windows บอก 0% จริงคือ 33.33%
- **แก้:** คำนวณจาก `(ส่ง - echo reply จริง) / ส่ง × 100` (`echoLossPercent`) ใช้ที่ ping loop, `check/:id`, `check-ip` (3 packets) และ `POST /test/ping-check` (2 packets)
- **ข้อจำกัด:** `latency_ms` ยังมาจากบรรทัด Average ของ Windows — เครื่องที่ตอบ `time<1ms` จะได้ `0` ซึ่งเป็นค่าที่มีความหมาย (เร็วมาก) ไม่ใช่ "ไม่มีข้อมูล"

### แก้เวลาวัด (แยกเป็นเรื่องที่ 2)

- **เดิม:** loop ใช้เวลาเริ่ม batch เป็น `checked_at` ของทุกเครื่องใน batch — เครื่องที่ต้อง fallback หรือ retry ถูกวัดจริงช้ากว่านั้นได้ถึง ~30 วิ
- **แก้:** `checked_at` = เวลาที่ probe ตัดสินผลของเครื่องนั้นเสร็จ (`measured_at`) แยกรายเครื่อง (ยังเลื่อนตาม `DB_TIMEZONE_OFFSET` เหมือนเดิม และ `describeLiveStatus` ชดเชยค่านี้ตอนคำนวณอายุ)
- **ยืนยันจาก log จริงหลัง deploy:** batch เดียวกัน เครื่อง 2–10 ได้ `11:14:32` ส่วนเครื่อง 1 (ที่ gateway ไม่ตอบ ต้อง fallback) ได้ `11:14:39` — เดิมจะเป็นเวลาเดียวกันทั้ง 10 เครื่อง
- `check/:id` และ `check-ip` ใช้เวลาหลัง probe เสร็จอยู่แล้ว ไม่เปลี่ยน

### การทดสอบ N1

- **Unit (`node --test tests/device-status.test.js`) 6/6 ผ่าน** — packet loss จาก echo reply (รวมกรณี Windows บอก 0% แต่จริง 33%, และ Windows บอก 33% แต่จริง 100%), สด/เก่า/ขอบ threshold พอดี, แถว 5 เดือนที่พบใน production เป็น `unknown`, ข้อมูลว่าง/วันที่อ่านไม่ได้/status ไม่รู้จัก, env override, การชดเชย `DB_TIMEZONE_OFFSET`
- **กับ server จริง:** `/metrics` 197 เครื่องสดทั้งหมด (`live_status: up`), `/down` ว่าง, `/status-summary` มี `live`, `POST check` ได้ field ใหม่, `GET check` ได้ header deprecation, 404 เดิมยังทำงาน, loop เขียน log ต่อเนื่องหลัง refactor

### ยังไม่ได้ทำใน N1

1. **`probed_ip` ยังไม่ถูกเก็บลง DB** — มีเฉพาะใน response ของ `check/:id` ผลจาก loop ไม่มี field นี้ ต้องเพิ่ม column ใน `DeviceMetrics` (migration) ถ้าต้องการให้ `/metrics` บอกได้
2. **อุปกรณ์ที่ไม่มีแถวใน `DeviceMetrics` เลย** จะไม่ปรากฏใน `/metrics` ทั้งหมด (endpoint ตั้งต้นจาก DeviceMetrics) — ไม่ใช่ `unknown` แต่หายไปจากรายการ ตอนนี้ทุกเครื่องมีแถวแล้ว
3. **probe ล้มเหลวระดับ process** (spawn ping ไม่ได้) ยังถูกนับเป็น `down` ตามพฤติกรรมเดิม ไม่ได้แยกเป็น `unknown` — การเปลี่ยนต้องแก้ทั้ง loop, การแจ้งเตือน และ DeviceDowntime จึงควรเป็นงานแยก
4. **Teams bot** (`webhookController` คำสั่ง `status`/`check`) ยังแสดงจาก `status` ดิบ ไม่ได้ใช้ `live_status`
5. error ของ `check-ip` ยังส่ง `error.message` และ error handler กลางยังแนบ stack trace เมื่อ `NODE_ENV` ไม่ใช่ `production`

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
