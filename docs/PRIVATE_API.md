# Private API (`/api/private/*`)

## Authentication

ไม่ใช้ JWT — เช็คจาก **source IP** เท่านั้น (ต้องอยู่ใน `PRIVATE_API_ALLOWED_IPS` ใน `.env`, คั่นด้วย comma) ถ้า IP ไม่อยู่ในลิสต์ จะได้ `403` ทันทีจาก middleware ก่อนถึง controller ([ipAllowlistMiddleware.js](../src/middleware/ipAllowlistMiddleware.js))

ออกแบบมาสำหรับ internal webserver อีกตัวที่แชร์ database เดียวกัน ไม่ใช่ end user — ฝั่งที่เรียกไม่ต้องแนบ token/header ใดๆ เพิ่ม แค่ยิงจาก IP ที่อยู่ใน allowlist

เพราะไม่มี `req.user`:
- audit log ทุกจุดจะบันทึก `user_id: null`, `user_name: 'Unknown'`
- `PUT /pea-jobs/:id` แก้ได้เฉพาะ field ระดับ "open" เท่านั้น (ดูหมายเหตุด้านล่าง) เพราะ logic ถือว่าไม่ใช่ super_admin เสมอ

---

## PeaJobs

| Method | Path | Body ที่ต้องส่ง |
|---|---|---|
| GET | `/pea-jobs` | - |
| GET | `/pea-jobs/:id` | - |
| POST | `/pea-jobs` | **`pea_site_id`\*, `job_name`\*** + optional: `job_description`, `job_type`, `priority`, `department`, `requester_name`, `requester_emp_id`, `requester_contact`, `notification_doc_no`, `equipment_ids` (array), `problem_equipment_ids` (array), `budget_transaction_ids` (array) |
| PUT | `/pea-jobs/:id` | optional (ส่งเฉพาะ field ที่จะแก้): `job_name`, `job_description`, `job_type`, `priority`, `department`, `requester_name`, `requester_emp_id`, `requester_contact`, `notification_doc_no` |
| DELETE | `/pea-jobs/:id` | - |

### ค่า parameter และชนิดข้อมูล (PeaJobs)

| Field | ชนิด | ค่าที่ควรใช้ | หมายเหตุ |
|---|---|---|---|
| `pea_site_id` | integer | id ของ `PeaSite` ที่มีอยู่จริง | ไม่ validate ว่ามีอยู่จริงหรือไม่ตอน create — ถ้าใส่ id ไม่มีจริง จะสร้าง job ลอยไม่มี site ผูกอยู่ (ไม่ error) |
| `job_name` | string | ข้อความอิสระ, ห้ามว่าง (`notEmpty`) | ต้อง**ไม่ซ้ำ**กับ job อื่นที่ `pea_site_id` เดียวกัน — ซ้ำจะได้ `400` |
| `job_type` | string | ค่าที่ใช้จริงในระบบ (ไม่ enforce เป็น enum ใน DB): `แจ้งซ่อม`, `ขออุปกรณ์ใหม่`, `ขอเปลี่ยนอุปกรณ์`, `แจ้งระบบใช้งานไม่ได้` | ส่งค่าอื่นได้ ไม่ error แต่ frontend อื่นๆ ในระบบคาดหวัง 4 ค่านี้ |
| `priority` | string | `เร่งด่วน` หรือ `ปกติ` | ไม่ส่ง = ใช้ default `ปกติ` |
| `status` | string | (สร้างอัตโนมัติ ไม่ต้องส่งตอน POST) | ลำดับที่ระบบตั้งใจ: `เปิดงาน` → `ระหว่างดำเนินการ` → `เสร็จงาน` (หรือ `ยกเลิก` จาก 2 สถานะแรก) — แก้ผ่าน private route ไม่ได้ (ดูข้อจำกัดด้านล่าง) |
| `equipment_ids` / `problem_equipment_ids` | array of integer | id ของ `OfficeEquipment` ที่มีอยู่จริงเท่านั้น | ถ้ามี id ไหนไม่พบแม้แต่ตัวเดียว → **ทั้ง request ถูกปฏิเสธด้วย `404`** ก่อนจะสร้าง job ใดๆ (ตรวจก่อนเขียน DB) |
| `budget_transaction_ids` | array of integer | id ของ `BudgetTransaction` ที่มีอยู่จริง | ระบบเช็ค exact-duplicate (site + cost_center + ref_doc_no + value ฯลฯ) กับ `SiteBudgetTransaction` เดิม — ถ้าซ้ำแม้แต่รายการเดียว **reject ทั้ง request ด้วย `400`** ก่อนสร้าง job |
| `requester_emp_id` / `requester_contact` / `notification_doc_no` | string | ข้อความอิสระ | ไม่มี format validation |

> ⚠️ **ข้อจำกัดของ PUT**: ไม่มี JWT → ไม่มี `req.user` → แก้ `status`, `pea_site_id`, `progress_notes`, `work_order_no`, `closing_notes`, `cancelled_reason`, `notification_doc_file`, `completion_report_file` ผ่านทางนี้**ไม่ได้** (field เหล่านี้ต้อง role `super_admin` เท่านั้น ซึ่งต้องมี JWT) ต้องใช้ public endpoint ที่ login ด้วย role `super_admin` แทน — ส่งมาก็จะถูกเพิกเฉย ไม่ error แต่ไม่ถูกบันทึก

> ⚠️ **ไม่มี endpoint สำหรับเปลี่ยนสถานะงาน** (`เริ่มงาน` / `ปิดงาน` / `ยกเลิกงาน`) ใน private route — endpoint พวกนี้ (`updateJobProgress` ฯลฯ) ยังไม่ถูก mount ไว้ที่นี่ ถ้าต้องการใช้ต้องแจ้งเพิ่ม

---

## OfficeEquipment

### CRUD

| Method | Path | Body / Query ที่ต้องส่ง |
|---|---|---|
| GET | `/office-equipment` | query: `department`, `equipment_type`, `pea_site_id`, `exclude_pea_site_id`, `status`, `search`, `sort`, `order`, `page`, `limit` |
| GET | `/office-equipment/:id` | - |
| POST | `/office-equipment` | **`name`\*** + optional: `ip_address` (IPv4), `mac_address` (`xx:xx:xx:xx:xx:xx`), `department`, `pea_site_id`, `equipment_type`, `status`, `notes`, `contract_no`, `contract_start_date`, `contract_expiry_date`, `vendor`, `serial_number`, `asset_number`, `asset_owner`, `asset_owner_emp_id`, `storage_location` |
| PUT | `/office-equipment/:id` | field เดียวกับ POST ส่งเฉพาะที่จะแก้ (ค่า `''`/`null` จะถูกข้าม ไม่อัปเดต) |
| DELETE | `/office-equipment/:id` | - |

\* = required field

### ค่า parameter และชนิดข้อมูล (OfficeEquipment)

| Field | ชนิด | ค่าที่ควรใช้ / Validation | หมายเหตุ |
|---|---|---|---|
| `name` | string | ข้อความอิสระ | required เฉพาะตอน POST |
| `ip_address` | string | ต้องเป็น **IPv4** ที่ถูกต้อง (`net.isIPv4`) | ผิดรูปแบบ → `400` ทันที |
| `mac_address` | string | ต้องตรง regex `^([0-9a-fA-F]{2}[:-]){5}([0-9a-fA-F]{2})$` เช่น `AA:BB:CC:DD:EE:FF` หรือ `AA-BB-CC-DD-EE-FF` | ผิดรูปแบบ → `400` ทันที |
| `status` | string | free text, ไม่ enforce enum ใน DB — ค่าที่ระบบใช้จริง: `ใช้งาน` (default), `ถูกยืม` (ตั้งอัตโนมัติตอนยืม/คืน) | **ห้าม PUT เปลี่ยน `status` ขณะมี loan เปิดอยู่** (`returned_at IS NULL`) → ตอบ `400` "Cannot change status while equipment is borrowed..." ต้องคืนผ่าน `/return` ก่อน |
| `equipment_type`, `department`, `vendor`, `storage_location` | string | free text | ไม่มี validation รูปแบบ |
| `pea_site_id` | integer | id ของ `PeaSite` | ไม่ validate ว่ามีอยู่จริงตอน create/update |
| `contract_start_date`, `contract_expiry_date` | date (`YYYY-MM-DD`) | - | ไม่บังคับ start ≤ expiry |
| `serial_number`, `asset_number`, `ip_address`, `mac_address` | string | - | **เช็คซ้ำข้ามทั้งตาราง** — ถ้า `ip_address`/`mac_address`/`serial_number` ที่ส่งมาไปตรงกับอุปกรณ์ตัวอื่นที่มีอยู่แล้ว → ปฏิเสธด้วย `400` พร้อมชื่ออุปกรณ์/สำนักงานที่ชนกัน (ยกเว้นตัวเอง กรณี PUT) |
| `asset_owner`, `asset_owner_emp_id` | string | - | มีการเก็บ audit log แยกต่างหาก (`ASSET_INFO_CHANGE`) ทุกครั้งที่ค่าเปลี่ยน |

**การเรียงลำดับ (`GET /office-equipment`)**

- `sort` = ชื่อ column ที่จะใช้เรียง เลือกได้จาก: `name`, `ip_address`, `mac_address`, `department`, `pea_site_id`, `equipment_type`, `status`, `contract_no`, `contract_start_date`, `contract_expiry_date`, `vendor`, `serial_number`, `asset_number`, `asset_owner`, `asset_owner_emp_id`, `storage_location`, `createdAt`, `updatedAt`
- `order` = `asc` หรือ `desc` (ค่าอื่นที่ไม่ใช่ `asc` จะถูกมองเป็น `desc`)
- ไม่ส่งทั้งคู่ = `updatedAt desc` (พฤติกรรมเดิมก่อนมี sort)
- ส่ง `order` อย่างเดียวได้ = เปลี่ยนทิศทางของ `updatedAt`
- ส่ง `sort` เป็น column ที่ไม่อยู่ในลิสต์ → ตอบ `400` พร้อมรายชื่อ column ที่ใช้ได้ (ไม่ปล่อยให้ query พังเป็น 500)
- response จะมี field `sort: { field, order }` กลับมาด้วยเพื่อให้ frontend รู้ว่าเรียงด้วยอะไรอยู่
- ทุกการเรียงมี `id DESC` เป็นตัวตัดสินรอง เพื่อให้ pagination ไม่สลับตำแหน่งเมื่อมีหลายแถวที่ค่าเท่ากัน
- ค่า `NULL` จะมาก่อนเมื่อเรียง `asc` และไปอยู่ท้ายสุดเมื่อเรียง `desc` (พฤติกรรมมาตรฐานของ MySQL)

> ⚠️ **PUT ไม่รองรับการล้างค่าเป็นค่าว่าง**: ถ้าส่ง `''` หรือ `null` มาใน field ใดๆ ระบบจะ**ข้าม field นั้นไปเฉยๆ ไม่อัปเดต** (ไม่ error, ไม่ล้างค่าเดิม) — ถ้าต้องการล้างค่าจริงๆ ต้องแก้ตรงผ่าน DB หรือ endpoint อื่น
>
> ⚠️ ถ้าไม่มี field ไหนเปลี่ยนแปลงเลย (ค่าที่ส่งมาเหมือนค่าเดิมทั้งหมด หรือ deep-equal) → ตอบ `200` พร้อมข้อความ "No changes detected" โดยไม่เขียน DB และไม่สร้าง audit log

### Borrow / Return

Logic เหมือนกับ public route ทุกอย่าง (เรียก controller function เดียวกัน) ต่างแค่ชั้น auth

```
[ก่อนเริ่ม]  ระบบต้นทางต้องยิงมาจาก IP ที่อยู่ใน PRIVATE_API_ALLOWED_IPS
             ไม่งั้นโดน 403 ตั้งแต่ middleware
```

**1. ยืมทีละชิ้น**
```
POST /api/private/office-equipment/:id/borrow
Body: { borrower_name*, due_date?, notes?, borrower_emp_id?, borrower_contact? }
```
- เช็คก่อนว่ามี loan เปิดค้างอยู่ไหม → ถ้ามี ตอบ 400 ไม่ให้ยืมซ้ำ
- สร้าง `OfficeEquipmentLoan` ใหม่ (`batch_id` สุ่มใหม่ = batch ที่มี 1 ชิ้น)
- อัปเดต equipment `status → ถูกยืม`
- log audit action `BORROW`
- ยิง Teams notification (fire-and-forget)

**2. ยืมหลายชิ้นพร้อมกัน**
```
POST /api/private/office-equipment/borrow-batch
Body: { equipment_ids*: [...], borrower_name*, due_date?, notes?, borrower_emp_id?, borrower_contact? }
```
- All-or-nothing: มี id ไม่พบ หรือมีชิ้นไหนถูกยืมค้างอยู่แล้ว → ยกเลิกทั้งหมด ไม่สร้างอะไรเลย
- สร้าง loan ทุกชิ้นพร้อม `batch_id` เดียวกัน (`borrowed_at` เวลาเดียวกัน), status ทุกชิ้น → `ถูกยืม`
- log audit ทีละชิ้น, ยิง notification สรุปยอดครั้งเดียว (ไม่ยิงทีละชิ้น)

**3. คืนอุปกรณ์**
```
POST /api/private/office-equipment/:id/return
Body: { notes? }
```
- หา loan เปิด (`returned_at = null`) ล่าสุด → ถ้าไม่มี ตอบ 400
- set `returned_at = now`, อัปเดต `notes` ถ้ามีส่งมา
- equipment `status → ใช้งาน`
- log audit action `RETURN`, ยิง notification

**4. ดูประวัติ**
```
GET /api/private/office-equipment/loans          (ทุกอุปกรณ์, filter: status/equipment_id/pea_site_id/search/page/limit)
GET /api/private/office-equipment/:id/loans       (อุปกรณ์ชิ้นเดียว)
```

> ⚠️ **กติกาที่ยังคงอยู่เหมือน public**: ห้าม `PUT /office-equipment/:id` เปลี่ยน `status` ตรงๆ ขณะมี loan เปิดค้างอยู่ — ต้องคืนผ่าน `/return` ก่อนเท่านั้น (โค้ดเช็คจุดเดียวกันที่ [officeEquipmentController.js:464-474](../src/controllers/officeEquipmentController.js#L464-L474) ใช้ร่วมกันทั้ง public/private route)

### ค่า parameter และข้อจำกัด (Borrow / Return)

| Field | ชนิด | ข้อจำกัด |
|---|---|---|
| `borrower_name` | string | **required** ทั้งใน `/borrow` และ `/borrow-batch` — ไม่ส่งมา → `400` |
| `borrower_emp_id`, `borrower_contact` | string | optional, free text |
| `due_date` | date (`YYYY-MM-DD`) | optional, ไม่บังคับต้องเป็นวันในอนาคต — ใส่วันที่ผ่านมาแล้วก็ได้ ไม่ error |
| `notes` | string | optional |
| `equipment_ids` | array of integer (เฉพาะ `/borrow-batch`) | **required, ห้ามว่าง** (`400` ถ้า missing/ไม่ใช่ array/ length 0) — ทุก id ต้องมีอยู่จริงใน `OfficeEquipment` (เช็คด้วย `findAll` count เทียบจำนวน) ไม่งั้น `404` |
| `photo_path` (ใช้กับ endpoint อื่นในกลุ่มรูปภาพ ไม่ใช่ borrow) | - | ไม่เกี่ยวกับ flow ยืม-คืน |

**ข้อจำกัดเชิง business logic ที่ต้องระวัง**:
1. **1 อุปกรณ์ ยืมได้ครั้งละ 1 loan เท่านั้น** — เช็คจาก `returned_at IS NULL`; ยิง `/borrow` หรือ `/borrow-batch` ซ้ำกับอุปกรณ์ที่ยังไม่คืน → `400`
2. **`/borrow-batch` เป็น all-or-nothing** — ถ้าใน `equipment_ids` มีแม้แต่ชิ้นเดียวที่ id ไม่พบ หรือกำลังถูกยืมอยู่ จะไม่มีการสร้าง loan ใดๆ เลยแม้แต่ชิ้นที่ปกติ (ต้องเคลียร์ให้ครบก่อนแล้วยิงใหม่ทั้งชุด)
3. **`/return` ต้องมี loan เปิดอยู่ก่อน** — เรียกคืนอุปกรณ์ที่ status เป็น `ใช้งาน` อยู่แล้ว (ไม่มี loan เปิดค้าง) → `400` "is not currently marked as borrowed"
4. **ไม่มี endpoint สำหรับแก้ไข/ยกเลิก loan ที่สร้างไปแล้ว** (เช่น แก้ `due_date` หรือ `borrower_name` ทีหลัง) ต้องคืนแล้วยืมใหม่เท่านั้น
5. **Notification เป็น fire-and-forget** — ถ้า Teams webhook ล่ม/ช้า จะไม่ทำให้ request หลักช้าตาม แต่ก็หมายความว่า caller **ไม่มีทางรู้จาก response ว่าแจ้งเตือนสำเร็จหรือไม่**

---

## Sequence Diagram

```
Internal Server                Private API                     DB
      |                             |                            |
      |--- (source IP check) ------>|                            |
      |                             |                            |
      |--POST /borrow-------------->|                            |
      |                             |--check open loan---------->|
      |                             |<---none found---------------|
      |                             |--create loan (batch_id)---->|
      |                             |--update status=ถูกยืม------->|
      |                             |--log audit BORROW---------->|
      |                             |--notify Teams (async)------>|
      |<--201 created---------------|                            |
      |                             |                            |
      |--POST /:id/return---------->|                            |
      |                             |--find open loan------------>|
      |                             |<---loan found----------------|
      |                             |--set returned_at=now-------->|
      |                             |--update status=ใช้งาน------->|
      |                             |--log audit RETURN----------->|
      |<--200 ok--------------------|                            |
```
