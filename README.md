# Solar Backend

Backend สำหรับระบบ Solar Monitoring — Express + Prisma + PostgreSQL + BullMQ (Redis)

รองรับ API สำหรับหน้า FE หลายโมดูล (homepage, monitoring, alarms/admin alarms, stock, jobs, report center, client data) และมี **Worker process** แยกสำหรับ cron sync jobs + background job processing

---

## Architecture Overview

ระบบแบ่งเป็น 2 process หลัก:

| Process | Command | Port | หน้าที่ |
|---------|---------|------|---------|
| **API** | `npm run start:api` | 3000 | REST API สำหรับ Frontend (ไม่รัน cron jobs) |
| **Worker** | `npm run start:worker` | 3001 | Cron sync jobs (Huawei) + BullMQ job processors (report/email) |

- **Dev mode** (`npm run dev`): รัน API + cron ใน process เดียว (monolith) ถ้าไม่ได้ set `DISABLE_CRON=1`
- **Production**: แยก API กับ Worker คนละ container — API set `DISABLE_CRON=1`, Worker รัน `start:worker`
- **Redis** (optional): ใช้สำหรับ BullMQ job queue (report generation, email sending) — เปิดด้วย `USE_QUEUE=true`

### New DB Tables (Migration: `20260326064743`)

- **`SiteHourlyKpi`** — เก็บ hourly KPI ของแต่ละ site (production, irradiation, grid import/export, consumption, battery)
- **`AuxDeviceSnapshot`** — เก็บ snapshot ข้อมูล auxiliary devices (EMI, Grid Meter, Battery, ESS, Power Sensor)

---

## Quick start (Install & Run)

### Prerequisites

- Node.js >= 20
- Docker & Docker Compose (สำหรับ local DB)
- Redis (optional — ใช้เมื่อเปิด `USE_QUEUE=true` สำหรับ BullMQ)
- เชื่อมต่อ VPN / อยู่ในเครือข่ายเดียวกับ cloud server ได้ (ถ้าใช้ cloud DB/MinIO)


### ใช้ Cloud DB (ต้องต่อ VPN)

```bash
# 1. ขอ .env จากทีม (มี cloud DB IP และ credentials)
# 2. ติดตั้ง dependencies + generate Prisma client
npm install

# 3. run dev (จะ prisma generate อัตโนมัติก่อน start)
npm run dev
```

Default server: `http://localhost:3000`

### รัน Worker แยก (production-style)

```bash
# Terminal 1 — API only (no cron)
DISABLE_CRON=1 npm run start:api    # port 3000

# Terminal 2 — Worker (cron + BullMQ)
npm run start:worker                 # port 3001
```

### อัพเดทโค้ดใหม่ (git pull)

```bash
git pull
npm install      # จะรัน prisma generate อัตโนมัติ (postinstall)
npm run dev      # จะรัน prisma generate อีกรอบก่อน start (predev)
```

> **หมายเหตุ**: ไม่จำเป็นต้องลบ `node_modules` แล้วลงใหม่ — Prisma จะ generate engine binary ให้ถูก platform (Windows/macOS/Linux) อัตโนมัติ

> **Troubleshooting**:
> - ถ้า Prisma error ให้รัน `npx prisma generate` อีกครั้ง
> - ถ้าใช้ macOS แล้ว puppeteer error ให้รัน `npx puppeteer browsers install chrome`

---

## Environment variables (.env)

### Database

```env
DATABASE_URL="postgresql://solar_admin:<password>@<cloud-ip>:5432/solar_db?schema=public"
```

> NOTE: DB อยู่บน cloud server แล้ว — ดู IP จริงใน `.env`

### Huawei FusionSolar (Northbound API)

```env
HUAWEI_API_BASE_URL="https://intl.fusionsolar.huawei.com"
HUAWEI_USER="pvscada"
HUAWEI_PASSWORD="Scada1234!"
```

### JWT (Login)

```env
JWT_SECRET="your_secret_here"
```

> NOTE: ปัจจุบัน middleware auth มีอยู่ แต่ route ส่วนใหญ่ “ยังไม่ได้บังคับ” ใช้ token

### Email (SMTP / Gmail)

```env
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER="yourgmail@gmail.com"
SMTP_PASS="xxxx xxxx xxxx xxxx"  # app password
SMTP_FROM="PowerVault Service <yourgmail@gmail.com>"
```

### Storage (Uploads: Local / MinIO)

ปัจจุบันใช้ MinIO (object storage บน cloud server) เป็นหลัก โค้ดรองรับทั้ง local disk และ MinIO/S3-compatible ผ่าน gateway เดียวกัน (`/uploads/...`)

```env
# local | minio
STORAGE_DRIVER="local"

# local uploads root (default: uploads)
STORAGE_LOCAL_ROOT="uploads"

# public prefix (default: /uploads)
STORAGE_PUBLIC_BASE="/uploads"

# object storage endpoint + credentials (required when STORAGE_DRIVER=minio)
MINIO_ENDPOINT="http://localhost:9000"
MINIO_BUCKET="solar-files"
MINIO_REGION="us-east-1"
MINIO_ACCESS_KEY="minioadmin"
MINIO_SECRET_KEY="minioadmin"

# read/write switches
READ_FROM_OBJECT_STORAGE=false
WRITE_TO_OBJECT_STORAGE=false
FALLBACK_TO_DISK=true
MINIO_KEEP_LOCAL_COPY=true
```

> NOTE: ถ้าเปิด MinIO แต่ค่า endpoint/bucket/credential ไม่ครบ ระบบจะ fallback เป็น local behavior ตาม flag ที่ตั้งไว้

### Cron Schedules & Sync Health

```env
# cron expressions (ปรับเวลา sync ได้)
HUAWEI_SITE_REALTIME_CRON="*/5 * * * *"          # site realtime ทุก 5 นาที
HUAWEI_DEVICE_CRON="2-59/5 * * * *"              # device sync ทุก 5 นาที (offset :02)
HUAWEI_ALARM_CRON="1-59/5 * * * *"               # alarm sync ทุก 5 นาที (offset :01)
HUAWEI_DAILY_KPI_CRON="15 * * * *"               # daily KPI ทุกชั่วโมงที่ :15
HUAWEI_HOURLY_KPI_CRON="10-59/15 * * * *"        # hourly KPI ทุก 15 นาที (:10,:25,:40,:55)
HUAWEI_AUX_REALTIME_CRON="3-59/5 * * * *"        # aux device sync ทุก 5 นาที (offset :03)
HUAWEI_MONTHLY_KPI_CRON="20 */4 * * *"           # monthly KPI ทุก 4 ชั่วโมงที่ :20

# watchdog: ตรวจจับ sync job ค้าง
HUAWEI_SYNC_WATCHDOG_INTERVAL_MS=60000      # ตรวจทุก 60 วินาที
HUAWEI_SYNC_WATCHDOG_STALE_MS=900000        # ถือว่าค้างเมื่อเกิน 15 นาที

# health check (/healthz)
HUAWEI_SYNC_HEALTH_MAX_LAG_MS=1200000       # lag เกิน 20 นาที = unhealthy (503)

# alarm auto-refresh cooldown (ใช้ใน /api/alarms?refresh=1)
HUAWEI_ALARM_AUTO_REFRESH_MIN_INTERVAL_MS=60000
```

### Redis (BullMQ Job Queue)

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=""
USE_QUEUE=false          # เปิดเป็น true เพื่อใช้ BullMQ (ต้องมี Redis)
```

เมื่อเปิด `USE_QUEUE=true` จะมี 2 queue:

| Queue | หน้าที่ | Concurrency | Retry |
|-------|---------|-------------|-------|
| `report-generation` | สร้าง PDF report (Puppeteer) | 1 | 2 attempts, exponential backoff 5s |
| `email-sending` | ส่ง email (SMTP) | 3 | 3 attempts, exponential backoff 3s |

> ถ้า `USE_QUEUE=false` (default) report generation และ email จะทำงานแบบ synchronous ใน API process แทน

### Frontend Integration Guide (USE_QUEUE=true)

เมื่อเปิด `USE_QUEUE=true` endpoint ที่เกี่ยวกับ **report generation** และ **email sending** จะเปลี่ยน response — แทนที่จะได้ผลลัพธ์ทันที จะได้ `taskId` กลับมาแทน แล้ว frontend ต้อง **poll** เช็คสถานะ

#### Endpoint ที่ได้รับผลกระทบ (8 endpoints):

| Module | Endpoint | เดิมทำอะไร | เปลี่ยนเป็นอะไร |
|--------|----------|-----------|-----------------|
| Cleaning | `POST /api/cleaning/step4/generate` | สร้าง PDF ทันที | enqueue → return taskId |
| Cleaning | `POST /api/cleaning/step2/send` | ส่ง email ทันที | enqueue → return taskId |
| Cleaning | `POST /api/cleaning/step5/send` | ส่ง email + report ทันที | enqueue → return taskId |
| Service | `POST /api/service/step4/generate` | สร้าง PDF ทันที | enqueue → return taskId |
| Service | `POST /api/service/step2/send` | ส่ง email ทันที | enqueue → return taskId |
| Service | `POST /api/service/step5/send` | ส่ง email + report ทันที | enqueue → return taskId |
| Inspection | `POST /api/inspection/step2/send` | ส่ง email ทันที | enqueue → return taskId |
| Inspection | `POST /api/inspection/step3/send` | ส่ง email + report ทันที | enqueue → return taskId |

#### Response เปรียบเทียบ:

**USE_QUEUE=false (เดิม/default):** ไม่มีอะไรเปลี่ยน response เหมือนเดิมทุกอย่าง

**USE_QUEUE=true — Report Generation (step4/generate):**

```json
// POST /api/cleaning/step4/generate  { "jobId": 123 }
// Response 200:
{
  "success": true,
  "data": { "taskId": "abc-123", "status": "queued" }
}
```

**USE_QUEUE=true — Email Sending (step2/send, step5/send, step3/send):**

```json
// POST /api/cleaning/step2/send  { "jobId": 123 }
// Response 200:
{
  "success": true,
  "data": { "taskId": "def-456", "status": "queued" }
}
```

#### Task Polling Endpoint:

```
GET /api/tasks/:taskId?queue=report-generation|email-sending
```

**Query params:**
- `queue` (optional, default: `report-generation`) — ชื่อ queue ที่ task อยู่

**Response 200:**

```json
{
  "success": true,
  "data": {
    "taskId": "abc-123",
    "queue": "report-generation",
    "state": "completed",
    "progress": 100,
    "result": { "fileUrl": "/uploads/reports/cleaning/Cleaning-Report-CL-001.pdf" },
    "failedReason": null
  }
}
```

**state values:**

| State | ความหมาย | Frontend ควรทำ |
|-------|----------|---------------|
| `waiting` | รออยู่ใน queue | แสดง loading, poll ต่อ |
| `active` | กำลังประมวลผล | แสดง loading + progress %, poll ต่อ |
| `completed` | เสร็จแล้ว | อ่าน `result` แล้วหยุด poll |
| `failed` | ล้มเหลว | แสดง `failedReason` แล้วหยุด poll |
| `delayed` | รอ retry (backoff) | แสดง loading, poll ต่อ |

**Response 404:** (taskId ไม่เจอ)

```json
{ "success": false, "message": "Task not found" }
```

#### Frontend Flow ตัวอย่าง (Report Generation):

```
1. User กด "สร้างรายงาน"
2. Frontend POST /api/cleaning/step4/generate { jobId: 123 }
3. ได้ { taskId: "abc-123", status: "queued" }
4. Frontend เริ่ม poll ทุก 2-3 วินาที:
   GET /api/tasks/abc-123?queue=report-generation
5. state = "waiting" → แสดง "กำลังรอคิว..."
6. state = "active", progress = 40 → แสดง "กำลังสร้างรายงาน 40%"
7. state = "completed" → อ่าน result.fileUrl → แสดงปุ่มดาวน์โหลด / redirect
8. หยุด poll
```

#### Frontend Flow ตัวอย่าง (Email Sending):

```
1. User กด "ส่งอีเมล"
2. Frontend POST /api/cleaning/step2/send { jobId: 123 }
3. ได้ { taskId: "def-456", status: "queued" }
4. Frontend อาจ poll หรือไม่ poll ก็ได้ (email เป็น fire-and-forget)
   - ถ้าอยากรู้ผล: poll GET /api/tasks/def-456?queue=email-sending
   - ถ้าไม่สน: แสดง "ส่งอีเมลแล้ว" ทันที (DB ถูก update เรียบร้อยแล้ว)
```

#### วิธี detect ว่า USE_QUEUE เปิดอยู่ไหม:

Frontend ไม่ต้อง detect — แค่เช็ค response:
- ถ้าได้ `data.taskId` → อยู่ใน queue mode → ต้อง poll
- ถ้าได้ `data.reportUrl` หรือ `success: true` แบบปกติ → mode เดิม ไม่ต้องทำอะไรเพิ่ม

```typescript
// ตัวอย่าง Frontend logic:
const res = await fetch('/api/cleaning/step4/generate', { method: 'POST', body: JSON.stringify({ jobId }) });
const json = await res.json();

if (json.data?.taskId) {
  // Queue mode — start polling
  pollTask(json.data.taskId, 'report-generation');
} else if (json.data?.reportUrl) {
  // Sync mode — use result directly
  showReport(json.data.reportUrl);
}
```

---

## Uploads (ไฟล์แนบ)

- ไฟล์ที่อัปโหลดจะถูกเก็บไว้ที่ `uploads/`
- เส้นทางเปิดไฟล์คือ `GET /uploads/<filePath>` และ `HEAD /uploads/<filePath>`
- การอ่านไฟล์ผ่าน storage gateway (รองรับ local และ object storage)
- ทุก endpoint ที่เป็นไฟล์ต้องส่ง `multipart/form-data`
- ชื่อ field ของไฟล์ “ต้องตรงตามที่กำหนดในแต่ละ endpoint” ไม่งั้นจะเจอ `MulterError: Unexpected field`
- หากเปิด object storage และไฟล์ไม่พบบน object storage ระบบสามารถ fallback ไป disk ได้ตาม `FALLBACK_TO_DISK`

---

## API Conventions

### Base URL

- Local: `http://localhost:3000`
- ทุก path ด้านล่างเป็น path เต็ม (ขึ้นด้วย `/api/...`)

### Response styles (ตามโค้ดปัจจุบัน)

โค้ดตอนนี้มี 2 style หลัก:

1) ส่วนใหญ่ (homepage/stock/jobs/reports/client-data) คืน:

```json
{ "success": true, "data": {} }
```

2) Monitoring module คืน:

```json
{ "data": {} }
```

> Error payload บางจุดเป็น `{ success:false, message }` และบางจุดเป็น `{ error: "..." }` (ยังไม่ได้ unify)

### Date/Time & Timezone

Backend นี้มีการรับค่า “วัน/เวลา” อยู่หลายแบบ (ขึ้นกับโมดูล) เพื่อให้ FE ส่งค่าได้ถูกต้อง แนะนำใช้ตามนี้:

- **ISO datetime (แนะนำเมื่อเป็นช่วงเวลา filter)**: `YYYY-MM-DDTHH:mm:ss.sssZ` หรือมี timezone เช่น `+07:00`
  - ตัวอย่าง: `2026-03-13T10:30:00+07:00`
  - ใช้กับ: alarm `from/to`, stock `dateFrom/dateTo`, client-data filters ที่เป็นวันที่แบบ ISO
- **Date (วันล้วน)**: `YYYY-MM-DD`
  - ใช้กับ: job step1 `workDate`, cleaning jobs filter `date`, monitoring strings history `date`
  - ตัวอย่าง: `2026-03-13`
- **Time (เวลาเป็นข้อความ)**: `HH:mm`
  - ใช้กับ: job step1 `workTimeText`
  - ตัวอย่าง: `10:00`
- **Month selector**: `YYYY-MM`
  - ใช้กับ: report center `startMonth/endMonth`, monitoring energy-management `view=month`
  - ตัวอย่าง: `2026-03`
- **Year selector**: `YYYY`
  - ใช้กับ: monitoring energy-management `view=year`, monitoring PR `year`
  - ตัวอย่าง: `2026`
- **Huawei `collectTime`**: millisecond timestamp (Unix epoch ms)
  - ตัวอย่าง: `collectTime=1773365400000`
  - แปลงจาก ISO ได้ด้วย `new Date('2026-03-13T12:30:00+07:00').getTime()`

**เรื่อง timezone ที่ต้องระวัง (สำคัญกับ Monitoring strings history):**

- `tzOffsetMinutes` ใช้ semantics เดียวกับ `Date.getTimezoneOffset()` (หน่วยเป็นนาที)
  - กรุงเทพ (UTC+7) จะได้ค่า `-420`
  - ตัวอย่างเรียกแบบ “เอาข้อมูลของวันที่ 2026-03-01 ตามเวลาท้องถิ่น (กรุงเทพ)”
    - `GET /api/monitoring/inverters/10/strings/history?date=2026-03-01&tzOffsetMinutes=-420`

### Common HTTP errors

- `400` invalid input / missing required fields
- `404` entity not found
- `500` internal error

---

## Health Check Endpoints (Worker — port 3001)

### GET `/healthz`

**Description:** Cron job health check — ตรวจว่า sync jobs ทั้ง 7 ตัว (siteRealtime, device, alarm, dailyKpi, hourlyKpi, auxRealtime, monthlyKpi) ยังทำงานปกติ (ถ้า lag เกิน `HUAWEI_SYNC_HEALTH_MAX_LAG_MS` จะตอบ 503)

**Response 200 (healthy):**

```json
{
  "ok": true,
  "now": 1711100000000,
  "maxLagMs": 1200000,
  "jobs": [
    { "jobName": "siteRealtime", "running": false, "lastAttemptAt": 1711099800000, "lastSuccessAt": 1711099800000, "lagMs": 200000 }
  ],
  "unhealthyJobs": []
}
```

**Response 503 (unhealthy):** เมื่อมี job ที่ lag เกินกำหนด

### GET `/readyz`

**Description:** Readiness check — ตรวจว่าสามารถ login Huawei API ได้

**Response 200:**

```json
{ "ok": true }
```

**Response 503:**

```json
{ "ok": false, "error": "Login failed: ..." }
```

---

## Auth APIs (`/api/auth`)

### POST `/api/auth/login`

**Description:** Login และรับ JWT token

**Auth:** None

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "username": "admin", "password": "password" }
```

**Response 200 (example):**

```json
{
  "message": "Login successful",
  "token": "<jwt>",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "ADMIN",
    "firstName": "Somchai"
  }
}
```

**Errors:**

- `401` `{ "message": "Invalid username or password" }`

---

## Homepage APIs (`/api/homepage`)

### GET `/api/homepage/summary`

**Description:** Summary สำหรับ dashboard (plant status + active alarms + notification alarms)

**Auth:** None

**Query params:** none

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "plantStatus": { "normal": 3, "faulty": 1, "disconnected": 2 },
    "activeAlarms": {
      "critical": 2,
      "major": 1,
      "minor": 0,
      "warning": 5,
      "supported": true
    },
    "notificationAlarms": [
      {
        "plantName": "Solar Farm A",
        "detail": "Grid Fault",
        "severity": 4,
        "occurredAt": "2026-02-26T01:10:00.000Z",
        "inverterName": "INV-1"
      }
    ]
  }
}
```

> NOTE: severity ใน DB ใช้ตัวเลข และถูกแปลงเป็นกลุ่ม (critical/major/minor/warning) ฝั่ง backend

### GET `/api/homepage/plants`

**Description:** List plants สำหรับตารางหน้า homepage

**Auth:** None

**Query params:**

- `q` (optional): search by `name` or `plantCode`
- `page` (optional, default `1`)
- `pageSize` (optional, default `20`, min `10`, max `100`)

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "siteId": 1,
        "plantCode": "PLANT-001",
        "plantName": "Solar Farm A",
        "address": "Bangkok",
        "status": "Normal",
        "gridConnectionDate": null,
        "totalStringCapacityKWp": 500,
        "optimizerQuantity": null,
        "currentPowerKW": 42.123,
        "specificEnergyKWhPerKWp": 1.2345,
        "yieldTodayKWh": 617.5,
        "totalYieldKWh": null,
        "performanceRatio": null,
        "lastUpdatedAt": "2026-02-03T01:00:00.000Z"
      }
    ],
    "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
  }
}
```

---

## Monitoring APIs (`/api/monitoring`)

### GET `/api/monitoring/sync/status`

**Description:** สถานะ Cron jobs ทั้งหมด (siteRealtime, device, alarm, dailyKpi, hourlyKpi, auxRealtime, monthlyKpi)

**Auth:** None

**Response 200 (example):**

```json
{ "ok": true, "data": { "siteRealtime": { "running": false, "lastSuccessAt": "..." }, "device": { "running": false }, "alarm": { "running": false } } }
```

### GET `/api/monitoring/sync/coverage`

**Description:** Fleet sync coverage snapshot (สรุปว่ามี site/inverter กี่ตัว sync สำเร็จ)

**Auth:** None

**Response 200 (example):**

```json
{ "ok": true, "data": { "totalSites": 10, "syncedSites": 9, "totalInverters": 50, "syncedInverters": 48 } }
```

### GET `/api/monitoring/sync/alarm-reconciliation`

**Description:** Alarm reconciliation snapshot (สรุปจำนวน alarm active/cleared/stale)

**Auth:** None

**Response 200 (example):**

```json
{ "ok": true, "data": { "activeInDb": 25, "clearedInDb": 100, "stale": 2 } }
```

### GET `/api/monitoring/sites`

**Description:** List sites สำหรับหน้า monitoring

**Auth:** None

**Response 200 (example):**

```json
{
  "data": [
    {
      "id": 1,
      "plantCode": "PLANT-001",
      "name": "Solar Farm A",
      "capacityKWp": 500,
      "address": "Bangkok",
      "latitude": 13.7,
      "longitude": 100.5,
      "updatedAt": "2026-02-03T01:00:00.000Z"
    }
  ]
}
```

### GET `/api/monitoring/sites/:siteId/overview`

**Description:** Site overview (site info + inverter list + energy series ล่าสุด ~7 วัน)

**Auth:** None

**Path params:**

- `siteId` (required, number)

**Query params (optional):**

- `refresh`:
  - `soft` = พยายาม refresh ถ้าข้อมูลไม่ครบ/เก่า
  - `1 | true | full` = force refresh (หนักสุด)

**Response 200 (example):**

```json
{
  "data": {
    "site": { "id": 1, "plantCode": "PLANT-001", "name": "Solar Farm A", "capacityKWp": 500 },
    "inverters": [
      {
        "id": 10,
        "name": "INV-1",
        "model": "SUN2000",
        "serialNumber": "SN-ABC",
        "activePower": 8.2,
        "lastDailyEnergy": 34.5,
        "status": "Normal",
        "lastSyncAt": "2026-02-03T01:00:00.000Z"
      }
    ],
    "energySeries": [{ "date": "2026-02-01T00:00:00.000Z", "energyKWh": 613.5 }],
    "hydration": {
      "attempted": true,
      "trigger": "soft",
      "hasRealtime": true,
      "hasInventory": true,
      "hasLiveInverterData": true,
      "ready": true
    },
    "lastUpdatedAt": "2026-02-03T01:05:00.000Z"
  }
}
```

**Errors:**

- `400` `{ "error": "Invalid siteId" }`
- `404` `{ "error": "Site not found" }`

### POST `/api/monitoring/sites/:siteId/refresh`

**Description:** Force refresh ข้อมูล site/inverter จาก Huawei (ใช้ตอน FE ต้องการปุ่ม Refresh)

**Auth:** None

**Path params:**

- `siteId` (required, number)

**Query params (optional):**

- `mode`: `full | site` (default `full`)
  - `full`: refresh site realtime + device detail
  - `site`: refresh เฉพาะ site realtime

**Request body (optional):**

```json
{ "mode": "full" }
```

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "mode": "full",
    "refreshResult": {},
    "site": { "id": 1, "plantCode": "PLANT-001" },
    "inverterCount": 12
  }
}
```

**Errors:**

- `400` `{ "error": "Invalid siteId" }`
- `404` `{ "error": "Site not found" }`
- `400` `{ "error": "Site plantCode is missing" }`

### GET `/api/monitoring/inverters/:inverterId`

**Description:** Inverter detail header/realtime summary

**Auth:** None

**Path params:**

- `inverterId` (required, number)

**Response 200 (example):**

```json
{
  "data": {
    "id": 10,
    "name": "INV-1",
    "model": "SUN2000",
    "serialNumber": "SN-ABC",
    "softwareVersion": null,
    "deviceReplacementRecord": null,
    "stationCode": "ST-001",
    "site": { "id": 1, "name": "Solar Farm A", "plantCode": "PLANT-001" },
    "realtime": {
      "activePower": 8.2,
      "dayEnergy": 34.5,
      "status": "Normal",
      "lastSyncAt": "2026-02-03T01:00:00.000Z"
    }
  }
}
```

### GET `/api/monitoring/inverters/:inverterId/strings/latest`

**Description:** Latest string snapshot

**Auth:** None

**Path params:**

- `inverterId` (required, number)

**Response 200 (example):**

```json
{
  "data": {
    "ts": "2026-02-03T01:00:00.000Z",
    "strings": [{ "stringNo": 1, "voltage": 450.2, "current": 9.5, "status": "Normal" }]
  }
}
```

**Response 200 (no snapshot yet):**

```json
{ "data": { "ts": null, "strings": [] } }
```

### GET `/api/monitoring/inverters/:inverterId/history`

**Description:** Series data สำหรับ line chart

**Auth:** None

**Path params:**

- `inverterId` (required, number)

**Query params:**

- `metric` (optional, default `activePower`): `activePower | dayEnergy | temperature | powerFactor`
- `range` (optional, default `day`): `day | week | month`

**Response 200 (example):**

```json
{
  "data": {
    "metric": "activePower",
    "range": "day",
    "series": [
      { "t": "2026-02-03T00:00:00.000Z", "v": 2.3 },
      { "t": "2026-02-03T00:05:00.000Z", "v": 2.8 }
    ]
  }
}
```

**Errors:**

- `400` `{ "error": "Invalid metric" }`
- `400` `{ "error": "Invalid range" }`

### GET `/api/monitoring/inverters/:inverterId/strings/history`

**Description:** Historical PV string series (current/voltage) สำหรับกราฟ Historical Information

**Auth:** None

**Path params:**

- `inverterId` (required, number)

**Query params (optional):**

- `date`: `YYYY-MM-DD` (ถ้าส่งมา จะตีความเป็น “วันตามเวลาท้องถิ่นของผู้ใช้” โดยต้องใช้ `tzOffsetMinutes` เพื่อแปลงเป็นช่วงเวลา UTC)
- `tzOffsetMinutes` (default `0`): semantics เดียวกับ `Date.getTimezoneOffset()`
- `range` (default `day`): `day | week | month` (ใช้เมื่อไม่ได้ส่ง `date`)
- `stringNo`: number (ดึงเฉพาะ string เดียว)
- `includeDisconnected`: `true | false` (default `false`)

**Response 200 (example):**

```json
{
  "data": {
    "inverterId": 10,
    "date": null,
    "tzOffsetMinutes": 0,
    "range": "day",
    "from": "2026-02-02T01:00:00.000Z",
    "to": "2026-02-03T01:00:00.000Z",
    "stringNo": null,
    "includeDisconnected": false,
    "seriesByString": [
      {
        "stringNo": 1,
        "points": [
          { "t": "2026-02-03T00:00:00.000Z", "current": 9.5, "voltage": 450.2, "status": "Normal" },
          { "t": "2026-02-03T00:05:00.000Z", "current": 9.7, "voltage": 451.0, "status": "Normal" }
        ]
      }
    ]
  }
}
```

**Errors:**

- `400` `{ "error": "Invalid inverterId" }`
- `400` `{ "error": "Invalid date (expected YYYY-MM-DD)" }`
- `400` `{ "error": "Invalid tzOffsetMinutes" }`
- `400` `{ "error": "Invalid range" }`
- `400` `{ "error": "Invalid stringNo" }`

### GET `/api/monitoring/pr/sites`

**Description:** สรุป PR หลาย site ตามช่วงเดือน (ใช้ทำตารางเปรียบเทียบหลายโครงการ)

**Auth:** None

**Query params:**

- `startMonth` (required): `YYYY-MM`
- `endMonth` (optional): `YYYY-MM` (default = `startMonth`)
- `siteIds` (optional): comma-separated เช่น `1,2,3`
- `q` (optional): search by `site.name` หรือ `plantCode`

**Response 200 (example):**

```json
{
  "data": {
    "months": ["2026-01", "2026-02"],
    "list": [
      {
        "siteId": 1,
        "plantName": "Solar Farm A",
        "plantCode": "PLANT-001",
        "systemSizeKWp": 500,
        "period": { "startMonth": "2026-01", "endMonth": "2026-02" },
        "totals": {
          "irradiation": { "actual": 10.2, "forecast": 9.8, "varPct": 4.082 },
          "production": { "actual": 5100, "forecast": 5000, "varPct": 2.0 },
          "pr": { "actual": 46.3, "forecast": 45.8, "varPct": 1.092 }
        },
        "months": []
      }
    ]
  }
}
```

**Errors:**

- `400` `{ "error": "startMonth is required (YYYY-MM)" }`
- `400` `{ "error": "Invalid month range" }`

### GET `/api/monitoring/pr/export`

**Description:** Export PR summary หลาย site เป็น CSV

**Auth:** None

**Query params:**

- `startMonth` (required): `YYYY-MM`
- `endMonth` (optional): `YYYY-MM` (default = `startMonth`)
- `siteIds` (required): comma-separated เช่น `1,2,3`

**Response 200:** `text/csv` พร้อม `Content-Disposition: attachment`

**Errors:**

- `400` `{ "error": "startMonth is required (YYYY-MM)" }`
- `400` `{ "error": "siteIds is required" }`

### GET `/api/monitoring/pr`

**Description:** PR page (Irradiation / Production / Performance Ratio) — Actual from Huawei + Forecast from DB

**Auth:** None

**Query params:**

- `siteId` (required): number
- `granularity` (optional, default `month`): `day | month | year`
- `collectTime` (optional): millisecond timestamp (Huawei key)
- `endDate` (optional): ISO date (fallback for `day` if no `collectTime`)
- `year` (optional): number (fallback for `month/year` if no `collectTime`)

**Response 200 (example: `granularity=month`):**

```json
{
  "data": {
    "siteId": 1,
    "granularity": "month",
    "year": 2026,
    "collectTime": 1769878800000,
    "rows": [
      {
        "month": 1,
        "irradiation": { "actual": 5.381, "forecast": 5.1, "varPct": 5.51 },
        "production": { "actual": 2444.89, "forecast": 2500, "varPct": -2.2 },
        "pr": { "actual": 45.451, "forecast": 48, "varPct": -5.31 }
      }
    ]
  }
}
```

**Response 200 (example: `granularity=day`):**

```json
{
  "data": {
    "siteId": 1,
    "granularity": "day",
    "collectTime": 1769878800000,
    "rows": [
      {
        "date": "2026-02-01",
        "irradiation": { "actual": 5.381, "forecast": null, "varPct": null },
        "production": { "actual": 2444.89, "forecast": null, "varPct": null },
        "pr": { "actual": 45.451, "forecast": null, "varPct": null }
      }
    ]
  }
}
```

**Response 200 (example: `granularity=year`):**

```json
{
  "data": {
    "siteId": 1,
    "granularity": "year",
    "collectTime": 1769878800000,
    "forecast": { "irradiation": 60.1, "production": 25000, "pr": 48 },
    "rows": [
      {
        "year": 2026,
        "irradiation": { "actual": 58.9, "forecast": 60.1, "varPct": -2.0 },
        "production": { "actual": 24500, "forecast": 25000, "varPct": -2.0 },
        "pr": { "actual": 47.1, "forecast": 48, "varPct": -1.88 }
      }
    ]
  }
}
```

**Errors:**

- `400` `{ "error": "Invalid siteId" }`
- `400` `{ "error": "Invalid granularity" }`
- `404` `{ "error": "Site not found" }`

### GET `/api/monitoring/sites/:siteId/energy-management`

**Description:** Series สำหรับหน้า Energy management (day/month/year/lifetime)

**Auth:** None

**Path params:**

- `siteId` (required, number)

**Query params (optional):**

- `view` (default `day`): `day | month | year | lifetime`
- `date` (optional): anchor date ของกราฟ (ขึ้นกับ `view`)
  - `view=day` ใช้ `YYYY-MM-DD` เช่น `2026-03-13`
  - `view=month` ใช้ `YYYY-MM` เช่น `2026-03`
  - `view=year` ใช้ `YYYY` เช่น `2026`
  - ถ้าส่งเป็น ISO datetime ก็ได้

**Example:**

- `GET /api/monitoring/sites/1/energy-management?view=day&date=2026-03-13`
- `GET /api/monitoring/sites/1/energy-management?view=month&date=2026-03`

**Response 200:**

```json
{ "data": { "siteId": 1, "view": "day", "collectTime": 1773364800000, "points": [] } }
```

**Errors:**

- `400` `{ "error": "Invalid siteId" }`
- `400` `{ "error": "Invalid view" }`

### GET `/api/monitoring/sites/:siteId/home-realtime`

**Description:** ข้อมูล realtime สำหรับหน้า Home (รวม energy-flow/summary cards/supporting data)

**Auth:** None

**Path params:**

- `siteId` (required, number)

**Query params (optional):**

- `refresh`:
  - `1 | true | full` = force refresh
  - ถ้าไม่ส่งมา จะเป็น `auto`

**Response 200:**

```json
{ "data": { "siteId": 1, "plantCode": "PLANT-001", "fetchedAt": "2026-03-13T03:30:00.000Z" } }
```

### GET `/api/monitoring/sites/:siteId/energy-flow`

**Description:** Shortcut คืนเฉพาะ `energyFlow` (เรียก service เดียวกับ home-realtime)

**Query params:** เหมือน `/home-realtime`

**Response 200:**

```json
{ "data": { "siteId": 1, "energyFlow": {} } }
```

### GET `/api/monitoring/sites/:siteId/summary-cards`

**Description:** Shortcut คืนเฉพาะ `summaryCards` + `supportingData` (เรียก service เดียวกับ home-realtime)

**Query params:** เหมือน `/home-realtime`

**Response 200:**

```json
{ "data": { "siteId": 1, "summaryCards": [], "supportingData": {} } }
```

### GET `/api/monitoring/sites/:siteId/reports`

**Description:** ดึงรายการ report ทั้งหมดของ site นั้น (ใช้ในหน้า Monitoring > Report tab)

**Auth:** None

**Path params:**

- `siteId` (required): number — ID ของ site

**Response 200:**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "id": 1,
        "jobNo": "CLN-250301-001",
        "title": "Cleaning Q1",
        "type": "CLEANING",
        "status": "COMPLETED",
        "createdAt": "2026-03-01T10:00:00.000Z",
        "reportCreatedAt": "2026-03-02T08:00:00.000Z",
        "previewUrl": "https://storage.example.com/reports/cleaning-001.pdf",
        "downloadUrl": "https://storage.example.com/reports/cleaning-001.pdf"
      }
    ]
  }
}
```

> หมายเหตุ: คืนเฉพาะ job ที่มี report URL แล้วเท่านั้น (`reportUrl`, `cleaningJob.reportFileUrl`, `serviceJob.reportFileUrl`, หรือ `inspectionJob.reportFileUrl`) — ถ้า site ไม่มี report จะได้ `"list": []`

---

## Alarm APIs (`/api/alarms`)

### GET `/api/alarms`

**Description:** List alarms (Active/Historical) + search + pagination

**Auth:** None

**Query params:**

- `tab` (optional, default `active`): `active | historical`
- `page` (optional, default `1`)
- `pageSize` (optional, default `20`, min `10`, max `100`)
- `siteId` (optional): number
- `inverterId` (optional): number
- `severity` (optional): number
- `q` (optional): search by alarm name
- `alarmId` (optional): match `raw.alarmId`
- `sn` (optional): inverter serialNumber (backend จะ map เป็น `inverterId` ให้)
- `from` (optional): ISO datetime filter `occurredAt >= from`
- `to` (optional): ISO datetime filter `occurredAt <= to`
- `refresh` (optional):
  - `1` = พยายาม sync alarm on-demand (ต้องส่ง `siteId` หรือ `inverterId` มาด้วย)
  - `0` = ปิด auto-refresh (กรณี `tab=active` และมี `siteId`/`inverterId`)
- `includeDeleted` (optional): ถ้าเป็น `1` จะรวม alarm ที่ถูก soft-delete (default ซ่อน)

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "id": 1,
        "severity": 4,
        "severityText": "Critical",
        "plantName": "Solar Farm A",
        "deviceType": "SUN2000",
        "deviceTypeId": 1,
        "deviceName": "INV-1",
        "alarmName": "Grid Fault",
        "alarmId": "12345",
        "sn": "SN-ABC",
        "occurredAt": "2026-02-26T01:10:00.000Z",
        "occurrenceTime": "2026-02-26T01:10:00.000Z",
        "clearedAt": null,
        "status": "ACTIVE",
        "acknowledgedAt": null,
        "acknowledgedBy": null,
        "deletedAt": null,
        "operation": { "viewDetails": true, "acknowledge": true, "delete": true },
        "raw": { "alarmId": "12345", "devName": "INV-1" }
      }
    ],
    "pagination": { "page": 1, "pageSize": 10, "total": 1, "totalPages": 1 }
  }
}
```

### GET `/api/alarms/:id`

**Description:** Alarm details (ใช้สำหรับหน้า View Details)

**Auth:** None

**Path params:**

- `id` (required, number)

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "severity": 4,
    "severityText": "Critical",
    "plantName": "Solar Farm A",
    "plantCode": "PLANT-001",
    "inverterId": 10,
    "inverterName": "INV-1",
    "deviceType": "SUN2000",
    "deviceTypeId": 1,
    "deviceName": "INV-1",
    "sn": "SN-ABC",
    "alarmName": "Grid Fault",
    "alarmId": "12345",
    "occurredAt": "2026-02-26T01:10:00.000Z",
    "occurrenceTime": "2026-02-26T01:10:00.000Z",
    "clearedAt": null,
    "status": "ACTIVE",
    "acknowledgedAt": null,
    "acknowledgedBy": null,
    "deletedAt": null,
    "deletedBy": null,
    "raw": { "alarmId": "12345", "devName": "INV-1" }
  }
}
```

**Errors:**

- `400` `{ "success": false, "message": "Invalid id" }`
- `404` `{ "success": false, "message": "Alarm not found" }`

### POST `/api/alarms/:id/acknowledge`

**Description:** Acknowledge alarm (เขียน `_meta.acknowledgedAt/acknowledgedBy` ลงใน `raw`)

**Auth:** None (ถ้ามี auth middleware จะใช้ `req.user` เป็น `acknowledgedBy`, ถ้าไม่มีจะเป็น `system`)

**Request body:** none

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "acknowledgedAt": "2026-03-03T01:10:00.000Z",
    "acknowledgedBy": "system"
  }
}
```

**Errors:**

- `400` `{ "success": false, "message": "Invalid id" }`
- `404` `{ "success": false, "message": "Alarm not found" }`
- `409` `{ "success": false, "message": "Alarm already deleted" }`

### DELETE `/api/alarms/:id`

**Description:** Soft-delete alarm (เขียน `_meta.deletedAt/deletedBy` ลงใน `raw`) — list จะซ่อนโดย default

**Auth:** None (ถ้ามี auth middleware จะใช้ `req.user` เป็น `deletedBy`, ถ้าไม่มีจะเป็น `system`)

**Request body:** none

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "deletedAt": "2026-03-03T01:12:00.000Z",
    "deletedBy": "system"
  }
}
```

**Errors:**

- `400` `{ "success": false, "message": "Invalid id" }`
- `404` `{ "success": false, "message": "Alarm not found" }`

### GET `/api/alarms/export`

**Description:** Export alarms เป็น CSV (สูงสุด 50,000 rows)

**Auth:** None

**Query params:** เหมือน `/api/alarms` (ยกเว้น `refresh`, `includeDeleted`)

**Response 200:** `text/csv` พร้อม `Content-Disposition: attachment`

---

## Admin Alarm APIs (`/api/admin`)

ชุด endpoint นี้ behavior หลักเหมือน `/api/alarms` (list/details/ack/delete/export) แต่ใช้แยกสำหรับหน้าฝั่ง admin และรองรับ filter `plantName` เพิ่มใน list/export

### GET `/api/admin`

**Description:** List alarms สำหรับหน้าฝั่ง admin

**Query params:**

- เหมือน `/api/alarms`
- `plantName` (optional): contains search จากชื่อ site (`site.name`)

### GET `/api/admin/:id`

**Description:** Alarm details (เหมือน `/api/alarms/:id`)

### POST `/api/admin/:id/acknowledge`

**Description:** Acknowledge alarm (เหมือน `/api/alarms/:id/acknowledge`)

### DELETE `/api/admin/:id`

**Description:** Soft-delete alarm (เหมือน `/api/alarms/:id`)

### GET `/api/admin/export`

**Description:** Export CSV (เหมือน `/api/alarms/export`) และรองรับ `plantName`

---

## Stock APIs (`/api/stock`)

### GET `/api/stock/projects`

**Description:** ดึงรายชื่อ project จาก site master สำหรับ dropdown ในงานเบิกจ่าย

**Auth:** None

**Query params:**

- `q` (optional): search by `site.name` หรือ `plantCode`

**Response 200 (example):**

```json
{
  "success": true,
  "data": [
    { "siteId": 1, "project": "Solar Farm A", "plantCode": "PLANT-001" }
  ]
}
```

### GET `/api/stock/meta`

**Description:** Dropdown source (categories, units, active products)

**Auth:** None

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "categories": [{ "id": 1, "name": "Spare Parts" }],
    "units": [{ "id": 1, "name": "pcs" }],
    "products": [{ "id": 1, "sku": "SKU-001", "name": "MC4 Connector", "categoryId": 1, "unitId": 1 }]
  }
}
```

### POST `/api/stock/products`

**Description:** Create product

**Auth:** None

**Headers:** `Content-Type: application/json`

**Request body (required):**

```json
{ "sku": "SKU-001", "name": "MC4 Connector", "categoryId": 1, "unitId": 1 }
```

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "sku": "SKU-001",
    "name": "MC4 Connector",
    "categoryId": 1,
    "unitId": 1,
    "isActive": true
  }
}
```

### GET `/api/stock/summary`

**Description:** Summary คงเหลือ (All Stock)

**Auth:** None

**Query params:**

- `q` (optional): search by sku/name
- `categoryId` (optional)
- `unitId` (optional)
- `page` (optional, default `1`)
- `pageSize` (optional, default `20`, min `10`, max `100`)

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "productId": 1,
        "sku": "SKU-001",
        "category": "Spare Parts",
        "name": "MC4 Connector",
        "unit": "pcs",
        "inQty": 20,
        "outQty": 5,
        "onHand": 15
      }
    ],
    "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
  }
}
```

### GET `/api/stock/in`

**Description:** List Stock IN transactions

**Auth:** None

**Query params:**

- `page` (optional, default `1`)
- `pageSize` (optional, default `20`)
- Filters (optional): `q`, `sku`, `productName`, `project`, `categoryId`, `unitId`, `productId`, `dateFrom`, `dateTo`

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "id": 10,
        "txDate": "2026-02-03T01:00:00.000Z",
        "sku": "SKU-001",
        "category": "Spare Parts",
        "productName": "MC4 Connector",
        "unit": "pcs",
        "quantity": 20,
        "project": "Project A",
        "receiver": "Somchai",
        "vendor": "Supplier X",
        "insuranceCompany": "Insure Co",
        "insuranceNo": "INS-001",
        "note": "Initial stock in"
      }
    ],
    "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
  }
}
```

### POST `/api/stock/in`

**Description:** Create Stock IN transaction

**Auth:** None

**Headers:** `Content-Type: application/json`

**Request body (required):**

```json
{ "productId": 1, "quantity": 20 }
```

**Request body (optional fields):** `txDate`, `project`, `siteId`, `receiver`, `vendor`, `insuranceCompany`, `insuranceNo`, `note`

> NOTE: ถ้าส่ง `siteId` แต่ไม่ส่ง `project` backend จะเติมชื่อ project จาก `site.name` อัตโนมัติ

**Response 200 (example):**

```json
{ "success": true, "data": { "id": 999, "type": "IN", "productId": 1, "quantity": 20, "txDate": "2026-02-03T01:00:00.000Z" } }
```

### GET `/api/stock/out`

**Description:** List Stock OUT transactions

**Auth:** None

**Query params:** เหมือน `/api/stock/in`

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "id": 11,
        "txDate": "2026-02-03T02:00:00.000Z",
        "sku": "SKU-001",
        "category": "Spare Parts",
        "productName": "MC4 Connector",
        "unit": "pcs",
        "quantity": 5,
        "project": "Project A",
        "receiver": "Somchai",
        "vendor": "Supplier X",
        "insuranceCompany": "Insure Co",
        "insuranceNo": "INS-001",
        "note": "Stock out"
      }
    ],
    "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
  }
}
```

### POST `/api/stock/out`

**Description:** Create Stock OUT transaction (มี validation กันจ่ายออกเกินคงเหลือ)

**Auth:** None

**Headers:** `Content-Type: application/json`

**Request body (required):**

```json
{ "productId": 1, "quantity": 5 }
```

**Response 200 (example):**

```json
{ "success": true, "data": { "id": 1000, "type": "OUT", "productId": 1, "quantity": 5, "txDate": "2026-02-03T01:00:00.000Z" } }
```

**Request body (optional fields):** `txDate`, `project`, `siteId`, `receiver`, `vendor`, `insuranceCompany`, `insuranceNo`, `note`, `jobId`

> NOTE: `POST /api/stock/deduct` เป็น alias ของ `POST /api/stock/out`

### GET `/api/stock/deduct`

**Description:** Alias ของ `GET /api/stock/out`

**Query params / Response:** เหมือน `GET /api/stock/out`

**Errors:**

- `400` `{ "success": false, "message": "insufficient stock: onHand=<number>" }`

### Category master

#### GET `/api/stock/categories`

**Response 200 (example):**

```json
{ "success": true, "data": [{ "id": 1, "name": "Spare Parts" }] }
```

#### POST `/api/stock/categories`

**Request body (example):**

```json
{ "name": "Spare Parts" }
```

**Response 200 (example):**

```json
{ "success": true, "data": { "id": 1, "name": "Spare Parts" } }
```

#### PATCH `/api/stock/categories/:id`

**Request body (example):**

```json
{ "name": "Updated Name" }
```

**Response 200 (example):**

```json
{ "success": true, "data": { "id": 1, "name": "Updated Name" } }
```

#### DELETE `/api/stock/categories/:id`

**Response 200 (example):**

```json
{ "success": true }
```

**Errors:**

- `400` `{ "success": false, "message": "category is in use by products" }`

### Unit master

#### GET `/api/stock/units`

**Response 200 (example):**

```json
{ "success": true, "data": [{ "id": 1, "name": "pcs" }] }
```

#### POST `/api/stock/units`

**Request body (example):**

```json
{ "name": "pcs" }
```

**Response 200 (example):**

```json
{ "success": true, "data": { "id": 1, "name": "pcs" } }
```

#### PATCH `/api/stock/units/:id`

**Request body (example):**

```json
{ "name": "box" }
```

**Response 200 (example):**

```json
{ "success": true, "data": { "id": 1, "name": "box" } }
```

#### DELETE `/api/stock/units/:id`

**Response 200 (example):**

```json
{ "success": true }
```

**Errors:**

- `400` `{ "success": false, "message": "unit is in use by products" }`

---

## Cleaning / Inspection / Service (Job Flows)

แนวคิดหลักเหมือนกัน:

1) FE เรียก `GET .../projects` เพื่อ dropdown + auto-fill
2) `POST .../step1` เพื่อ create/update draft job (ได้ `jobId`)
3) `GET .../job/:jobId` เพื่อโหลดข้อมูลทั้งก้อน
4) Step2 draft/send (email)
5) Step3 upload/ฟอร์ม (ขึ้นกับโมดูล)
6) Cleaning/Service มี generate report + download + send report

> NOTE (Draft): ปัจจุบันมี 2 แนวทางการ “save draft”
>
> - **Save ข้อมูลของ step นั้น ๆ**: เรียก endpoint ของ step นั้น (เช่น `/step2/draft`, `/step3/checklist`) เพื่อเก็บรายละเอียด + ไฟล์แนบ
>   - Endpoint ของ step จะ bump `job.step` อัตโนมัติ (ไม่ถอยหลัง) และ set `job.status = DRAFT`
> - **Save progress (ปุ่ม Save Draft มุมขวาบน)**: เรียก `/api/drafts/save` เพื่ออัปเดตแค่ว่า draft ค้างอยู่ step ไหน (ไม่ validate ว่าข้อมูลครบ)

> NOTE (Download zip): endpoint ตระกูล `/jobs/download-zip` ใช้คำสั่ง `zip` บนเครื่อง server — ต้องมี `zip` อยู่ใน PATH ไม่งั้นจะได้ `500`.

### Draft / Resume APIs (`/api/drafts`)

#### POST `/api/drafts/save`

**Description:** Save progress ของ draft (อัปเดต `job.step`/`job.status`)

**Headers:** `Content-Type: application/json`

**Request body:**

```json
{ "jobId": 777, "step": 3 }
```

**Behavior:**

- `step` จะถูก clamp ตามประเภทงาน (เช่น INSPECTION max=3, CLEANING/SERVICE max=5)
- ระบบจะ update แบบ “ไม่ถอยหลัง” โดยใช้ `max(currentStep, step)`
- set `job.status = DRAFT`

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "id": 777,
    "jobNo": "SRV-20260303-000001",
    "type": "SERVICE",
    "status": "DRAFT",
    "step": 3,
    "updatedAt": "2026-03-06T01:00:00.000Z"
  }
}
```

**Errors:**

- `400` `{ "success": false, "message": "jobId is required" }`
- `404` `{ "success": false, "message": "Job not found" }`

#### GET `/api/drafts/email-signatures`

**Description:** ดึงรายการลายเซ็นท้ายอีเมลสำหรับ dropdown

**Auth:** None

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "supportsCustomName": true,
    "defaultKey": "palm",
    "defaultName": "palm",
    "items": []
  }
}
```

#### GET `/api/drafts`

**Description:** List draft jobs (status = `DRAFT`) เพื่อ resume งานที่ค้าง

**Query params (optional):**

- `jobType`: `CLEANING | SERVICE | INSPECTION`

**Response 200 (example):**

```json
{
  "success": true,
  "data": [
    {
      "jobId": 777,
      "jobNo": "SRV-20260303-000001",
      "jobType": "SERVICE",
      "step": 3,
      "siteId": 1,
      "projectName": "Solar Farm A",
      "updatedAt": "2026-03-06T01:00:00.000Z"
    }
  ]
}
```

### Cleaning APIs (`/api/cleaning`)

#### GET `/api/cleaning/projects`

**Query params (optional):**

- `q`: search by `projectName` / `plantCode`
- `page` (default `1`)
- `pageSize` (default `1000`, capped at `500`)

**Response 200 (example):**

```json
{
  "success": true,
  "pagination": { "page": 1, "pageSize": 1000, "total": 1, "totalPages": 1 },
  "data": [
    {
      "siteId": 1,
      "plantCode": "PLANT-001",
      "projectName": "Solar Farm A",
      "address": "Bangkok",
      "systemSizeKWp": 500,
      "pvModuleEA": 1200,
      "contactPhone": "0812345678",
      "contactEmail": "customer@example.com"
    }
  ]
}
```

#### GET `/api/cleaning/jobs`

**Description:** List Cleaning jobs สำหรับหน้า HomeCleaning

**Query params (optional):**

- `page` (default `1`)
- `pageSize` (default `20`, min `10`, max `100`)
- `jobNo` (contains)
- `projectType` (contains)
- `projectName` (contains)
- `systemSizeKWp` (exact)
- `pvModuleEA` (exact)
- `contractor` (contains)
- `problem` (contains)
- `status` (exact)
- `date`: `YYYY-MM-DD` (match work date)

**Response 200 (example):**

```json
{
  "success": true,
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "data": [
    {
      "jobId": 123,
      "jobNo": "CLN-20260303-000001",
      "projectType": "งาน",
      "projectName": "Solar Farm A",
      "systemSizeKWp": 500,
      "pvModuleEA": 1200,
      "date": "2026-03-03T00:00:00.000Z",
      "time": "10:00",
      "startTime": "10:00",
      "endTime": "12:00",
      "contractor": "Vendor X",
      "problem": "Inverter trip",
      "status": "DRAFT"
    }
  ]
}
```

#### GET `/api/cleaning/jobs/download-zip`

**Description:** ดาวน์โหลดรายงาน (PDF) ของ Cleaning หลายงานเป็นไฟล์ zip

**Query params:**

- `jobIds` (required): comma-separated เช่น `?jobIds=1,2,3` หรือส่งซ้ำหลายตัว `?jobIds=1&jobIds=2`

**Response 200:** `application/zip` (file download)

**Errors:**

- `400` `{ "success": false, "message": "jobIds is required" }`
- `404` `{ "success": false, "message": "No report files found for selected cleaning jobs", "skipped": ["..."] }`

#### POST `/api/cleaning/jobs/download-zip`

**Description:** เหมือน GET แต่ส่ง `jobIds` ผ่าน body (เหมาะกับ list ยาว)

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobIds": [123, 124, 125] }
```

**Response 200:** `application/zip` (file download)

#### POST `/api/cleaning/step1`

**Headers:** `Content-Type: application/json`

**Request body (create example):**

```json
{
  "siteId": 1,
  "projectType": "งาน",
  "contactPhone": "0812345678",
  "contactEmail": "customer@example.com",
  "workDate": "2026-02-15",
  "startTime": "10:00",
  "endTime": "12:00",
  "contractor": "Vendor X",
  "problem": "Inverter trip",
  "customerName": "Robinson Chachoengsao",
  "note": "เข้าหน้างานทางประตู A"
}
```

**Request body (update example):** ใส่ `jobId` เพื่อ update draft เดิม

```json
{ "jobId": 123, "siteId": 1, "workDate": "2026-02-16" }
```

**Response 200 (example):**

```json
{ "success": true, "data": { "jobId": 123, "jobNo": "CLN-20260303-000001" } }
```

#### GET `/api/cleaning/job/:jobId`

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "job": { "id": 123, "jobNo": "CLN-..." },
    "cleaning": { "jobId": 123 },
    "timeRange": { "startTime": "10:00", "endTime": "12:00", "workTimeText": "10:00-12:00" }
  }
}
```

#### PUT `/api/cleaning/job/:jobId`

**Description:** Update draft ของ Step1 (proxy ไปที่ `/api/cleaning/step1` โดยอ้างอิง `jobId` จาก path)

**Headers:** `Content-Type: application/json`

**Request body:** เหมือน `POST /api/cleaning/step1` (ไม่ต้องส่ง `jobId` ก็ได้)

**Response 200:** เหมือน `POST /api/cleaning/step1`

#### DELETE `/api/cleaning/job/:jobId`

**Description:** ลบ Cleaning job แบบ cascade (รวม attachments/report/email logs/stock usage ที่ผูกกับ job)

**Response 200 (example):**

```json
{ "success": true, "message": "Deleted CLN-20260303-000001" }
```

**Errors:**

- `400` `{ "success": false, "message": "jobId is required" }`
- `404` `{ "success": false, "message": "Cleaning job not found" }`

#### POST `/api/cleaning/step2/draft`

**Content-Type:** `multipart/form-data`

**Form fields:**

- `jobId` (required)
- `to`, `subject`, `body` (optional: save draft; แต่ต้องมีครบก่อนเรียก `/step2/send`)
- `signatureName` (optional): ชื่อผู้ลงนามท้ายอีเมล (ระบบจะใช้ตอนประกอบลายเซ็นอีเมล)

**Files:** `files` (file[], max 10)

**Response 200 (example):**

```json
{ "success": true }
```

> NOTE: ถ้าส่ง `signatureName` ใน `/step2/draft` ระบบจะบันทึก body ที่ต่อท้าย email signature ไว้ และตอน `/step2/send` จะส่งด้วยลายเซ็นนี้

#### POST `/api/cleaning/step2/send`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobId": 123 }
```

**Response 200 — USE_QUEUE=false (default):**

```json
{ "success": true }
```

**Response 200 — USE_QUEUE=true (queue mode):**

```json
{ "success": true, "data": { "taskId": "def-456", "status": "queued" } }
```

> ดู [Frontend Integration Guide](#frontend-integration-guide-use_queuetrue) สำหรับวิธี poll task status

> NOTE: ถ้าบางไฟล์แนบหายใน storage อาจมี `warning` กลับมา เช่น

```json
{
  "success": true,
  "warning": {
    "message": "บางไฟล์แนบไม่พบ จึงไม่ถูกแนบในอีเมล",
    "missing": ["/uploads/xxx.pdf"]
  }
}
```

**Errors:**

- `400` `{ "success": false, "message": "Email draft incomplete" }`

#### POST `/api/cleaning/step3/evidence`

**Content-Type:** `multipart/form-data`

**Form fields:**

- `jobId` (required)
- `labelType` (optional):
  - เอกสารส่งมอบงาน (full-page image ใน PDF): `CERTIFICATE`
  - Layout หน้าเต็ม: `LAYOUT`
  - รูปตามหัวข้อหน้าเว็บ Step3.1: `BEFORE_PANEL` | `DURING_PANEL` | `AFTER_PANEL` | `BEFORE_INVERTER` | `DURING_INVERTER` | `AFTER_INVERTER` | `ZONE_WORK` | `ZONE_CHECKLIST`
  - รองรับของเดิม (เก่า): `BEFORE` | `AFTER`
  - ถ้าไม่ส่งมา จะถือเป็น `EVIDENCE`

**Files:** `files` (file[], max 30)

**Response 200 (example):**

```json
{ "success": true }
```

#### POST `/api/cleaning/step3/checklist`

บันทึกข้อมูล checklist ของงาน cleaning → ใช้ในหน้า **"แผนการบำรุงรักษาเชิงป้องกัน"** ของ PDF report

> NOTE: หน้า "เอกสารส่งมอบงาน" (Certificate of Completion) ไม่ใช้ข้อมูลจาก checklist อีกต่อไป — ใช้การอัปโหลดรูปผ่าน `POST /api/cleaning/step3/evidence` แทน (labelType = `CERTIFICATE`)

**Headers:** `Content-Type: application/json`

---

##### โครงสร้าง Request Body

```
{
  "jobId": number,              // (required) รหัส job
  "checklistJson": { ... },     // (required) ข้อมูล checklist — ดูด้านล่าง
  "step3SummaryNote": string    // (optional) สรุปการทำงาน step 3
}
```

##### โครงสร้าง `checklistJson`

```
{
  "items": [ ... ]    // (required) รายการ checklist — ดูด้านล่าง
}
```

---

##### `items[]` — รายการ checklist (หัวข้อ fix ตายตัว)

**ตาราง "แผนการบำรุงรักษา" ใน PDF มีหัวข้อ fix ตายตัว 4 หมวด 7 รายการย่อย** — FE ส่งแค่ `status` (ติ๊กถูก) และ `remark` (หมายเหตุ) ของแต่ละรายการย่อย โดยใช้ `title` เป็น key สำหรับ match

**หัวข้อที่ fix ไว้:**

| ลำดับ | หมวด | รายการย่อย |
|-------|------|-----------|
| 1 | **แผงโซลาร์เซลล์** | - ตรวจสอบความสะอาดแผงและล้างแผงโซลาร์เซลล์ |
| | | - ตรวจสอบสภาพแผง สีกระจก และการเกิดออกไซต์ บน Frame |
| 2 | **Inverter Unit** | - ตรวจสอบสภาพและทำความสะอาด Filter |
| | | - ตรวจสอบการทำงานของพัดลมระบายอากาศและดูดฝุ่น |
| 3 | **Monitoring System** | - ตรวจสอบสภาพและทำความสะอาดภายในตู้ควบคุม คอมพิวเตอร์ |
| 4 | **ระบบน้ำทำความสะอาดแผงโซลาร์เซลล์** | - ตรวจสอบสภาพและความพร้อมของปั๊มน้ำและอุปกรณ์ Starter |
| | | - ตรวจสอบสภาพของหัวจ่ายน้ำ |

**แต่ละ child item มี field:**

| field | type | คำอธิบาย |
|-------|------|----------|
| `title` | `string` | ชื่อรายการ (ต้องตรงกับหัวข้อ fix ด้านบน เพื่อ match ข้อมูลลง PDF) |
| `status` | `string` | สถานะ: `"done"`, `"pass"`, `"completed"`, `"yes"` → แสดง ✓ / ค่าอื่นแสดงตามที่ส่ง |
| `remark` | `string` | หมายเหตุ |

---

##### ตัวอย่าง: ส่ง checklist ครบทุกหัวข้อ (แนะนำ)

```json
{
  "jobId": 24,
  "checklistJson": {
    "items": [
      {
        "title": "แผงโซลาร์เซลล์",
        "children": [
          { "title": "ตรวจสอบความสะอาดแผงและล้างแผงโซลาร์เซลล์", "status": "done", "remark": "แผงโซลาร์เซลล์สะอาดเรียบร้อย" },
          { "title": "ตรวจสอบสภาพแผง สีกระจก และการเกิดออกไซต์ บน Frame", "status": "done", "remark": "สภาพของกระจกยังปกติดี" }
        ]
      },
      {
        "title": "Inverter Unit",
        "children": [
          { "title": "ตรวจสอบสภาพและทำความสะอาด Filter", "status": "done", "remark": "อินเวอร์เตอร์สะอาดเรียบร้อย" },
          { "title": "ตรวจสอบการทำงานของพัดลมระบายอากาศและดูดฝุ่น", "status": "done", "remark": "ทำงานปกติ" }
        ]
      },
      {
        "title": "Monitoring System",
        "children": [
          { "title": "ตรวจสอบสภาพและทำความสะอาดภายในตู้ควบคุม คอมพิวเตอร์", "status": "done", "remark": "สะอาดเรียบร้อยดี" }
        ]
      },
      {
        "title": "ระบบน้ำทำความสะอาดแผงโซลาร์เซลล์",
        "children": [
          { "title": "ตรวจสอบสภาพและความพร้อมของปั๊มน้ำและอุปกรณ์ Starter", "status": "done", "remark": "ปกติดี" },
          { "title": "ตรวจสอบสภาพของหัวจ่ายน้ำ", "status": "done", "remark": "ปกติดี" }
        ]
      }
    ]
  },
  "step3SummaryNote": "ล้างแผงเสร็จเรียบร้อย ไม่พบความเสียหาย"
}
```

> **ผลลัพธ์ในหน้า "แผนการบำรุงรักษา":**
>
> | ลำดับ | อุปกรณ์/รายการ | การดำเนินการ | หมายเหตุ |
> |-------|---------------|-------------|----------|
> | 1 | **แผงโซลาร์เซลล์** | | |
> | | - ตรวจสอบความสะอาดแผงและล้างแผงโซลาร์เซลล์ | ✓ | แผงโซลาร์เซลล์สะอาดเรียบร้อย |
> | | - ตรวจสอบสภาพแผง สีกระจก และการเกิดออกไซต์ บน Frame | ✓ | สภาพของกระจกยังปกติดี |
> | 2 | **Inverter Unit** | | |
> | | - ตรวจสอบสภาพและทำความสะอาด Filter | ✓ | อินเวอร์เตอร์สะอาดเรียบร้อย |
> | | - ตรวจสอบการทำงานของพัดลมระบายอากาศและดูดฝุ่น | ✓ | ทำงานปกติ |
> | 3 | **Monitoring System** | | |
> | | - ตรวจสอบสภาพและทำความสะอาดภายในตู้ควบคุม คอมพิวเตอร์ | ✓ | สะอาดเรียบร้อยดี |
> | 4 | **ระบบน้ำทำความสะอาดแผงโซลาร์เซลล์** | | |
> | | - ตรวจสอบสภาพและความพร้อมของปั๊มน้ำและอุปกรณ์ Starter | ✓ | ปกติดี |
> | | - ตรวจสอบสภาพของหัวจ่ายน้ำ | ✓ | ปกติดี |

---

**Response 200:**

```json
{ "success": true }
```

**Response 400:**

```json
{ "success": false, "message": "jobId is required" }
```

#### POST `/api/cleaning/step4/generate`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobId": 123 }
```

**Response 200 — USE_QUEUE=false (default):**

```json
{
  "success": true,
  "data": { "reportUrl": "/uploads/report.pdf", "download": "/api/cleaning/step4/download/123" }
}
```

**Response 200 — USE_QUEUE=true (queue mode):**

```json
{
  "success": true,
  "data": { "taskId": "abc-123", "status": "queued" }
}
```

> ดู [Frontend Integration Guide](#frontend-integration-guide-use_queuetrue) สำหรับวิธี poll task status

> NOTE: ถ้ารูป/ไฟล์บางส่วนหาไม่เจอระหว่าง generate report ระบบจะข้ามไฟล์นั้นและอาจส่ง `warning.missing` กลับมา

**โครงสร้างหน้า PDF ที่ generate ได้:**

| ลำดับ | หน้า | แหล่งข้อมูล |
|-------|------|-------------|
| 1 | ปกรายงาน (Cover) | jobNo, projectName, workDate |
| 2 | เอกสารส่งมอบงาน (Certificate of Completion) | รูปที่อัปโหลดผ่าน `step3/evidence` (labelType=`CERTIFICATE`) — แสดงเป็น full-page image |
| 3 | Layout โครงการ (PV Layout) | ดึงจาก `SiteLayout` (client data, type=`PV_LAYOUT`) — แสดงเฉพาะเมื่อมีรูป |
| 4 | Legacy full-page docs | STEP3_LAYOUT attachments (backward compat) |
| 5 | แผนการบำรุงรักษาเชิงป้องกัน (Checklist) | `cleaningJob.checklist` JSON — หัวข้อ fix ตายตัว 4 หมวด ดูรายละเอียดที่ `step3/checklist` |
| 6+ | รูปภาพหลักฐาน (Evidence) | JobAttachment ที่ fileType ขึ้นต้นด้วย `STEP3_` (ยกเว้น CERTIFICATE/LAYOUT) |

> หน้า Certificate จะแสดงเมื่อมีรูปอัปโหลด `CERTIFICATE` — อัปโหลดผ่าน `POST /api/cleaning/step3/evidence` (labelType=`CERTIFICATE`)
> หน้า PV Layout จะแสดงเฉพาะเมื่อมีรูปใน `SiteLayout` (upload ผ่าน client data API `POST /api/client-data/projects/:siteId/layouts/PV_LAYOUT`)

#### GET `/api/cleaning/step4/download/:jobId`

**Description:** Redirect ไปไฟล์ report จริง

**Response 302:** redirect to `/uploads/...pdf`

#### POST `/api/cleaning/step5/draft`

**Description:** Save draft ข้อความอีเมลส่ง report (Step5) — ยังไม่ส่ง

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobId": 123, "to": "customer@example.com", "subject": "Report", "body": "<p>See attached</p>" }
```

> NOTE: `to/subject/body` เป็น optional ใน draft แต่ต้องครบก่อนเรียก `/step5/send`

**Response 200 (example):**

```json
{ "success": true }
```

#### POST `/api/cleaning/step5/send`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobId": 123, "to": "customer@example.com", "subject": "Report", "body": "<p>See attached</p>" }
```

**Response 200 — USE_QUEUE=false (default):**

```json
{ "success": true }
```

**Response 200 — USE_QUEUE=true (queue mode):**

```json
{ "success": true, "data": { "taskId": "ghi-789", "status": "queued" } }
```

> ดู [Frontend Integration Guide](#frontend-integration-guide-use_queuetrue) สำหรับวิธี poll task status

**Errors:**

- `400` `{ "success": false, "message": "Report not generated" }`
- `400` `{ "success": false, "message": "Report file not found" }`

### Inspection APIs (`/api/inspection`)

#### GET `/api/inspection/projects`

**Query params (optional):**

- `q`: search by `projectName` / `plantCode`
- `page` (default `1`)
- `pageSize` (default `1000`, capped at `500`)

**Response 200 (example):**

```json
{
  "success": true,
  "pagination": { "page": 1, "pageSize": 1000, "total": 1, "totalPages": 1 },
  "data": [
    {
      "siteId": 1,
      "plantCode": "PLANT-001",
      "projectName": "Solar Farm A",
      "address": "Bangkok",
      "systemSizeKWp": 500,
      "pvModuleEA": 1200,
      "contactPhone": "0812345678",
      "contactEmail": "customer@example.com"
    }
  ]
}
```

#### GET `/api/inspection/jobs`

**Description:** List Inspection jobs สำหรับหน้า HomeInspection

**Query params (optional):**

- `page` (default `1`)
- `pageSize` (default `20`, min `10`, max `100`)
- `jobNo` (contains)
- `projectType` (contains)
- `projectName` (contains)
- `systemSizeKWp` (exact)
- `pvModuleEA` (exact)
- `contractor` (contains)
- `problem` (contains)
- `status` (exact)
- `date`: `YYYY-MM-DD` (match work date)

**Response 200 (example):**

```json
{
  "success": true,
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "data": [
    {
      "jobId": 555,
      "jobNo": "INSP-20260303-000001",
      "projectType": "งาน",
      "projectName": "Solar Farm A",
      "systemSizeKWp": 500,
      "pvModuleEA": 1200,
      "date": "2026-03-03T00:00:00.000Z",
      "time": "10:00",
      "startTime": "10:00",
      "endTime": "12:00",
      "contractor": "Vendor X",
      "problem": "String alarm",
      "status": "DRAFT"
    }
  ]
}
```

#### GET `/api/inspection/jobs/download-zip`

**Description:** ดาวน์โหลดรายงาน (PDF) ของ Inspection หลายงานเป็นไฟล์ zip

**Query params:**

- `jobIds` (required): comma-separated เช่น `?jobIds=1,2,3` หรือส่งซ้ำหลายตัว `?jobIds=1&jobIds=2`

**Response 200:** `application/zip` (file download)

**Errors:**

- `400` `{ "success": false, "message": "jobIds is required" }`
- `404` `{ "success": false, "message": "No report files found for selected inspection jobs", "skipped": ["..."] }`

#### POST `/api/inspection/jobs/download-zip`

**Description:** เหมือน GET แต่ส่ง `jobIds` ผ่าน body

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobIds": [555, 556] }
```

**Response 200:** `application/zip` (file download)

#### POST `/api/inspection/step1`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{
  "siteId": 1,
  "workDate": "2026-02-15",
  "startTime": "10:00",
  "endTime": "12:00",
  "contractor": "Vendor X",
  "problem": "String alarm"
}
```

**Response 200 (example):**

```json
{ "success": true, "data": { "jobId": 555, "jobNo": "INSP-20260303-000001" } }
```

#### GET `/api/inspection/job/:jobId`

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "job": { "id": 555, "jobNo": "INSP-..." },
    "inspection": { "jobId": 555 },
    "timeRange": { "startTime": "10:00", "endTime": "12:00", "workTimeText": "10:00-12:00" }
  }
}
```

#### PUT `/api/inspection/job/:jobId`

**Description:** Update draft ของ Step1 (proxy ไปที่ `/api/inspection/step1` โดยอ้างอิง `jobId` จาก path)

**Headers:** `Content-Type: application/json`

**Request body:** เหมือน `POST /api/inspection/step1`

**Response 200:** เหมือน `POST /api/inspection/step1`

#### DELETE `/api/inspection/job/:jobId`

**Description:** ลบ Inspection job แบบ cascade

**Response 200 (example):**

```json
{ "success": true, "message": "Deleted INSP-20260303-000001" }
```

**Errors:**

- `400` `{ "success": false, "message": "jobId is required" }`
- `404` `{ "success": false, "message": "Inspection job not found" }`

#### POST `/api/inspection/step2/draft`

**Content-Type:** `multipart/form-data`

**Form fields:**

- `jobId` (required)
- `to`, `subject`, `body` (optional: save draft; แต่ต้องมีครบก่อนเรียก `/step2/send`)
- `signatureName` (optional): ชื่อผู้ลงนามท้ายอีเมล (ระบบจะใช้ตอนประกอบลายเซ็นอีเมล)

**Files:** `attachments` (file[], max 20)

**Response 200 (example):**

```json
{ "success": true }
```

> NOTE: ถ้าส่ง `signatureName` ใน `/step2/draft` ระบบจะบันทึก body ที่ต่อท้าย email signature ไว้ และตอน `/step2/send` จะส่งด้วยลายเซ็นนี้

#### POST `/api/inspection/step2/send`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobId": 555 }
```

**Response 200 — USE_QUEUE=false (default):**

```json
{ "success": true }
```

**Response 200 — USE_QUEUE=true (queue mode):**

```json
{ "success": true, "data": { "taskId": "xxx-123", "status": "queued" } }
```

> ดู [Frontend Integration Guide](#frontend-integration-guide-use_queuetrue) สำหรับวิธี poll task status

> NOTE: ถ้าบางไฟล์แนบหายใน `uploads/` อาจมี `warning` กลับมา เช่น

```json
{
  "success": true,
  "warning": {
    "message": "บางไฟล์แนบไม่พบในโฟลเดอร์ uploads จึงไม่ถูกแนบ",
    "missing": ["uploads/xxx.pdf"]
  }
}
```

#### POST `/api/inspection/step3/draft`

**Content-Type:** `multipart/form-data`

**Form fields:**

- `jobId` (required)
- `to`, `subject`, `body` (optional: save draft; แต่ต้องมีครบก่อนเรียก `/step3/send`)

**File:** `report` (file, single, optional ใน draft; แต่ต้องมี report ก่อนเรียก `/step3/send`)

**Response 200 (example):**

```json
{ "success": true }
```

#### POST `/api/inspection/step3/send`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobId": 555 }
```

**Response 200 — USE_QUEUE=false (default):**

```json
{ "success": true }
```

**Response 200 — USE_QUEUE=true (queue mode):**

```json
{ "success": true, "data": { "taskId": "xxx-456", "status": "queued" } }
```

> ดู [Frontend Integration Guide](#frontend-integration-guide-use_queuetrue) สำหรับวิธี poll task status

**Errors:**

- `400` `{ "success": false, "message": "Email draft incomplete (ต้องมี To/Subject/Body)" }`
- `400` `{ "success": false, "message": "Report not uploaded" }`
- `400` `{ "success": false, "message": "Report file not found" }`

### Service APIs (`/api/service`)

#### GET `/api/service/projects`

**Query params (optional):**

- `q`: search by `projectName` / `plantCode`
- `page` (default `1`)
- `pageSize` (default `1000`, capped at `500`)

**Response 200 (example):**

```json
{
  "success": true,
  "pagination": { "page": 1, "pageSize": 1000, "total": 1, "totalPages": 1 },
  "data": [
    {
      "siteId": 1,
      "plantCode": "PLANT-001",
      "projectName": "Solar Farm A",
      "address": "Bangkok",
      "systemSizeKWp": 500,
      "pvModuleEA": 1200,
      "contactPhone": "0812345678",
      "contactEmail": "customer@example.com"
    }
  ]
}
```

#### GET `/api/service/jobs`

**Description:** List Service jobs สำหรับหน้า HomeService

**Query params (optional):**

- `page` (default `1`)
- `pageSize` (default `20`, min `10`, max `100`)
- `jobNo` (contains)
- `projectType` (contains)
- `projectName` (contains)
- `systemSizeKWp` (exact)
- `pvModuleEA` (exact)
- `status` (exact)
- `service` (contains; currently match บาง field เช่น note)
- `contractor` (contains)
- `problem` (contains)
- `date`: `YYYY-MM-DD` (match work date)

**Response 200 (example):**

```json
{
  "success": true,
  "pagination": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 },
  "data": [
    {
      "jobId": 777,
      "jobNo": "SRV-20260303-000001",
      "projectType": "งาน",
      "projectName": "Solar Farm A",
      "systemSizeKWp": 500,
      "pvModuleEA": 1200,
      "date": "2026-03-03T00:00:00.000Z",
      "time": "10:00",
      "startTime": "10:00",
      "endTime": "12:00",
      "contractor": "Vendor X",
      "problem": "Battery warning",
      "status": "DRAFT"
    }
  ]
}
```

#### GET `/api/service/jobs/download-zip`

**Description:** ดาวน์โหลดรายงาน (PDF) ของ Service หลายงานเป็นไฟล์ zip

**Query params:**

- `jobIds` (required): comma-separated เช่น `?jobIds=1,2,3` หรือส่งซ้ำหลายตัว `?jobIds=1&jobIds=2`

**Response 200:** `application/zip` (file download)

**Errors:**

- `400` `{ "success": false, "message": "jobIds is required" }`
- `404` `{ "success": false, "message": "No report files found for selected service jobs", "skipped": ["..."] }`

#### POST `/api/service/jobs/download-zip`

**Description:** เหมือน GET แต่ส่ง `jobIds` ผ่าน body

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobIds": [777, 778, 779] }
```

**Response 200:** `application/zip` (file download)

#### POST `/api/service/step1`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{
  "siteId": 1,
  "workDate": "2026-02-15",
  "startTime": "10:00",
  "endTime": "12:00",
  "contractor": "Vendor X",
  "problem": "Battery warning",
  "note": "..."
}
```

**Response 200 (example):**

```json
{ "success": true, "data": { "jobId": 777, "jobNo": "SRV-20260303-000001" } }
```

#### GET `/api/service/job/:jobId`

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "job": {
      "id": 777,
      "jobNo": "SRV-20260303-000001",
      "title": "Service - Solar Farm A",
      "type": "SERVICE",
      "status": "DRAFT"
    },
    "service": {
      "jobId": 777,
      "projectName": "Solar Farm A",
      "systemSizeKWp": 500,
      "workTimeText": "10:00",
      "note": "..."
    },
    "timeRange": { "startTime": "10:00", "endTime": "12:00", "workTimeText": "10:00-12:00" }
  }
}
```

#### PUT `/api/service/job/:jobId`

**Description:** Update draft ของ Step1 (proxy ไปที่ `/api/service/step1` โดยอ้างอิง `jobId` จาก path)

**Headers:** `Content-Type: application/json`

**Request body:** เหมือน `POST /api/service/step1`

**Response 200:** เหมือน `POST /api/service/step1`

#### DELETE `/api/service/job/:jobId`

**Description:** ลบ Service job แบบ cascade

**Response 200 (example):**

```json
{ "success": true, "message": "Deleted SRV-20260303-000001" }
```

**Errors:**

- `400` `{ "success": false, "message": "jobId is required" }`
- `404` `{ "success": false, "message": "Service job not found" }`

#### POST `/api/service/step2/draft`

**Content-Type:** `multipart/form-data`

**Form fields:**

- `jobId` (required)
- `to`, `subject`, `body` (optional: save draft; แต่ต้องมีครบก่อนเรียก `/step2/send`)
- `signatureName` (optional): ชื่อผู้ลงนามท้ายอีเมล (ระบบจะใช้ตอนประกอบลายเซ็นอีเมล)

**Files:** `attachments` (file[], max 20)

**Response 200 (example):**

```json
{ "success": true }
```

> NOTE: ถ้าส่ง `signatureName` ใน `/step2/draft` ระบบจะบันทึก body ที่ต่อท้าย email signature ไว้ และตอน `/step2/send` จะส่งด้วยลายเซ็นนี้

#### POST `/api/service/step2/send`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobId": 777 }
```

**Response 200 — USE_QUEUE=false (default):**

```json
{ "success": true }
```

**Response 200 — USE_QUEUE=true (queue mode):**

```json
{ "success": true, "data": { "taskId": "xxx-789", "status": "queued" } }
```

> ดู [Frontend Integration Guide](#frontend-integration-guide-use_queuetrue) สำหรับวิธี poll task status

> NOTE: ถ้าบางไฟล์แนบหายใน storage อาจมี `warning` กลับมา เช่น

```json
{
  "success": true,
  "warning": {
    "message": "บางไฟล์แนบไม่พบ จึงไม่ถูกแนบในอีเมล",
    "missing": ["/uploads/xxx.pdf"]
  }
}
```

**Errors:**

- `400` `{ "success": false, "message": "Email draft incomplete (ต้องมี To/Subject/Body)" }`

#### POST `/api/service/step3/draft`

บันทึกข้อมูล Service Report (Step3) — อัปโหลดรูป Service Report + รูปหลักฐาน

**หลักการ:** หน้า Service Report ใน PDF ใช้ **รูปที่อัปโหลด** แสดงเต็มหน้า (รูปละ 1 หน้า) แทนการสร้าง digital form
ถ้าไม่อัปโหลดรูป `serviceReport` เลย → fallback เป็น digital form อัตโนมัติจาก `metaJson` + ข้อมูล Step1

**Content-Type:** `multipart/form-data`

---

##### Form Fields

| field | type | required | คำอธิบาย |
|-------|------|----------|----------|
| `jobId` | `number` | ✅ | รหัส job |
| `metaJson` | `string (JSON)` | optional | JSON string ข้อมูลรายละเอียดงานบริการ — ใช้เป็น fallback เมื่อไม่อัปโหลดรูป `serviceReport` และใช้สำหรับ stock sync |

##### Files (multipart)

| field name | type | คำอธิบาย |
|------------|------|----------|
| `serviceReport` | file[] (max 20) | รูป Service Report ที่เขียนด้วยมือ/scan — แสดงเป็นรูปเต็มหน้าใน PDF (รูปละ 1 หน้า) |
| `evidence` | file[] (max 30) | รูปภาพหลักฐานการปฏิบัติงาน — แสดงเป็นตาราง 2x2 ในหน้าถัดๆ ไป |

---

##### โครงสร้าง `metaJson` (optional — ใช้เป็น fallback + stock sync)

`metaJson` เป็น JSON string ที่ frontend ส่งมา — backend จะ parse แล้วเก็บลง `serviceJob.step3Meta` ทั้งก้อน

> **หมายเหตุ:** ถ้าอัปโหลดรูป `serviceReport` แล้ว ข้อมูลใน `metaJson` จะ **ไม่ถูกใช้สร้างหน้า PDF** (ยกเว้น `stockItems` ที่ยังใช้ sync stock)

```
{
  "serviceType": string,         // ลักษณะงานบริการ
  "technicianName": string,      // ชื่อ-นามสกุล ผู้เข้าตรวจสอบ
  "technicianPosition": string,  // ตำแหน่ง (default: "Service Technician")
  "projectType": string,         // ประเภทโครงการ (Solar Rooftop/Farm/Floating)
  "startDate": string,           // วันที่เริ่มเข้าดำเนินการ
  "endDate": string,             // วันที่เสร็จสิ้นงาน
  "customerName": string,        // ชื่อผู้รับรอง (ฝั่งลูกค้า)
  "customerPosition": string,    // สถานภาพ/ตำแหน่ง ผู้รับรอง
  "summary": string,             // หมายเหตุ
  "tasks": [ ... ],              // รายการงาน
  "stockItems": [ ... ]          // อุปกรณ์/อะไหล่ที่ใช้ → สร้าง Stock OUT
}
```

---

##### `stockItems[]` — อุปกรณ์/อะไหล่ที่ใช้

| field | type | คำอธิบาย |
|-------|------|----------|
| `productId` | `number` | รหัสสินค้า (รองรับ: `productId`, `id`, `product_id`) |
| `quantity` | `number` | จำนวนที่ใช้ (รองรับ: `quantity`, `qty`, `amount`) |

> **Stock OUT sync:**
> - Backend จะสร้าง `StockTransaction` type=OUT ให้อัตโนมัติจาก `stockItems`
> - ถ้า quantity เกินคงเหลือ จะตอบ `400`: `{ "success": false, "message": "insufficient stock for productId=1: onHand=10" }`
> - การเรียกซ้ำจะลบรายการ OUT เดิมที่สร้างจาก Step3 แล้วสร้างใหม่ (กันซ้ำ)
> - ตาราง Stock จะแสดงใน PDF เฉพาะเมื่อมี stockItems ที่ qty > 0

---

##### ตัวอย่าง 1: อัปโหลดรูป Service Report (แนะนำ)

อัปโหลดรูป Service Report ที่เขียนด้วยมือ + รูปหลักฐาน

```
POST /api/service/step3/draft
Content-Type: multipart/form-data

jobId: 777
serviceReport: [file: service-report-page1.jpg]
serviceReport: [file: service-report-page2.jpg]
evidence: [file: photo1.jpg]
evidence: [file: photo2.jpg]
evidence: [file: photo3.jpg]
evidence: [file: photo4.jpg]
```

> **ผลลัพธ์ใน PDF:**
> - หน้า 1: รูป service-report-page1.jpg เต็มหน้า
> - หน้า 2: รูป service-report-page2.jpg เต็มหน้า
> - หน้า 3+: รูป evidence ในตาราง 2x2

---

##### ตัวอย่าง 2: อัปโหลดรูป + ส่ง stock items

```
POST /api/service/step3/draft
Content-Type: multipart/form-data

jobId: 777
metaJson: {"stockItems":[{"productId":5,"quantity":150}]}
serviceReport: [file: service-form-scan.jpg]
evidence: [file: photo1.jpg]
```

> **ผลลัพธ์:**
> - PDF ใช้รูปที่อัปโหลดเป็นหน้า Service Report
> - Stock OUT ถูก sync จาก stockItems ใน metaJson

---

##### ตัวอย่าง 3: ไม่อัปโหลดรูป (fallback เป็น digital form)

ถ้าไม่อัปโหลดรูป `serviceReport` → backend จะ generate digital form จาก `metaJson` + ข้อมูล Step1 เหมือนเดิม

```
POST /api/service/step3/draft
Content-Type: multipart/form-data

jobId: 777
metaJson: {"serviceType":"การซ่อมบำรุง","technicianName":"กิตติพงษ์ กุลไพร","tasks":[{"name":"เปลี่ยนพัดลม","detail":"INV 1 = 30"}]}
evidence: [file: photo1.jpg]
```

> **ผลลัพธ์ใน PDF:**
> - หน้า 1: Digital Service Report Form (สร้างอัตโนมัติจาก metaJson)
> - หน้า 2: รูป evidence

---

**Response 200:**

```json
{ "success": true }
```

**Response 400:**

```json
{ "success": false, "message": "jobId is required" }
```

```json
{ "success": false, "message": "insufficient stock for productId=1: onHand=10" }
```

---

#### POST `/api/service/step4/generate`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobId": 777 }
```

**Response 200 — USE_QUEUE=false (default):**

```json
{ "success": true, "data": { "reportUrl": "/uploads/report.pdf", "download": "/api/service/step4/download/777" } }
```

**Response 200 — USE_QUEUE=true (queue mode):**

```json
{ "success": true, "data": { "taskId": "xxx-321", "status": "queued" } }
```

> ดู [Frontend Integration Guide](#frontend-integration-guide-use_queuetrue) สำหรับวิธี poll task status

> NOTE: ถ้ารูป/ไฟล์บางส่วนหาไม่เจอระหว่าง generate report ระบบจะข้ามไฟล์นั้น

**โครงสร้างหน้า PDF ที่ generate ได้:**

| ลำดับ | หน้า | แหล่งข้อมูล |
|-------|------|-------------|
| 1+ | SERVICE REPORT | รูปที่อัปโหลดผ่าน field `serviceReport` — แสดงเต็มหน้า (รูปละ 1 หน้า) ถ้าไม่มีรูป → fallback เป็น digital form จาก `step3Meta` |
| ถัดไป | รูปภาพประกอบการปฏิบัติงาน | `SERVICE_EVIDENCE` attachments — ตาราง 2x2 สูงสุด 4 รูป/หน้า (รวมไม่เกิน 12 รูป) |

#### GET `/api/service/step4/download/:jobId`

**Response 302:** redirect to `/uploads/...pdf`

#### POST `/api/service/step5/draft`

**Description:** Save draft ข้อความอีเมลส่ง report (Step5) — ยังไม่ส่ง

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobId": 777, "to": "customer@example.com", "subject": "Service report", "body": "<p>See attached</p>" }
```

> NOTE: `to/subject/body` เป็น optional ใน draft แต่ต้องครบก่อนเรียก `/step5/send`

**Response 200 (example):**

```json
{ "success": true }
```

#### POST `/api/service/step5/send`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "jobId": 777, "to": "customer@example.com", "subject": "Service report", "body": "<p>See attached</p>" }
```

**Response 200 — USE_QUEUE=false (default):**

```json
{ "success": true }
```

**Response 200 — USE_QUEUE=true (queue mode):**

```json
{ "success": true, "data": { "taskId": "xxx-654", "status": "queued" } }
```

> ดู [Frontend Integration Guide](#frontend-integration-guide-use_queuetrue) สำหรับวิธี poll task status

**Errors:**

- `400` `{ "success": false, "message": "Report not generated" }`
- `400` `{ "success": false, "message": "Report file not found" }`

---

## Report Center APIs (`/api/reports`)

### GET `/api/reports`

**Description:** List report documents (คืนเฉพาะ job ที่มี report แล้ว)

**Auth:** None

**Query params (optional):**

- `siteId`: number
- `startMonth`: `YYYY-MM`
- `endMonth`: `YYYY-MM`
- `jobType`: `CLEANING | SERVICE | INSPECTION`
- `q`: search by `job title` / `jobNo` / `site.name`

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "list": [
      {
        "id": 123,
        "jobNo": "CLN-20260303-000001",
        "title": "Cleaning - Solar Farm A",
        "type": "CLEANING",
        "status": "DRAFT",
        "site": { "id": 1, "name": "Solar Farm A" },
        "createdAt": "2026-03-03T01:00:00.000Z",
        "reportCreatedAt": "2026-03-03T02:00:00.000Z",
        "previewUrl": "/uploads/report.pdf",
        "downloadUrl": "/uploads/report.pdf"
      }
    ]
  }
}
```

### GET `/api/reports/energy-yield/sites`

**Description:** List sites สำหรับ dropdown หน้า Energy Yield

**Auth:** None

**Query params (optional):**

- `q`: search by `name` หรือ `plantCode`

**Response 200 (example):**

```json
{
  "success": true,
  "data": [
    { "siteId": 1, "plantName": "Solar Farm A", "plantCode": "PLANT-001", "systemSizeKWp": 500 }
  ]
}
```

### GET `/api/reports/energy-yield/:siteId`

**Description:** ข้อมูล Energy Yield รายวันของเดือนที่เลือก พร้อม chart data + PR report

**Auth:** None

**Path params:**

- `siteId` (required, number)

**Query params:**

- `month` (required): `YYYY-MM`

**Response 200:** `{ "success": true, "data": { site, month, monthTable, charts, summary, prReport } }`

**Errors:**

- `400` `{ "success": false, "message": "Invalid siteId" }`
- `400` `{ "success": false, "message": "month is required (YYYY-MM)" }`
- `404` `{ "success": false, "message": "Site not found" }`

---

## Client Data APIs (`/api/client-data`)

โมดูลนี้ใช้จัดการข้อมูลฝั่ง PowerVault (Thailand) และ PowerVault Service (projects, warranty, layouts, forecast, other, service entries)

### PowerVault (Thailand) - Projects

#### GET `/api/client-data/thailand/projects`

**Query params (optional):**

- `projectNo` (contains)
- `projectName` (contains)
- `systemSizeKWp` (exact)
- `endWarrantyBefore` (ISO date)
- `status` (`ACTIVE | INACTIVE | MAINTENANCE`)
- `page` (default `1`)
- `pageSize` (default `10`)

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "items": [
      {
        "siteId": 1,
        "projectNo": "PLANT-001",
        "projectName": "Solar Farm A",
        "systemSizeKWp": 500,
        "endWarranty": "2028-12-31T00:00:00.000Z",
        "status": "ACTIVE"
      }
    ]
  }
}
```

#### POST `/api/client-data/thailand/projects`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{
  "plantCode": "PLANT-002",
  "name": "Solar Farm B",
  "capacityKWp": 750,
  "projectStatus": "ACTIVE",
  "address": "Bangkok",
  "pvModuleEA": 1200,
  "contactPhone": "0812345678",
  "contactEmail": "customer@example.com",
  "warrantyEnd": "2028-12-31"
}
```

> NOTE: Endpoint นี้รองรับ alias ของขนาดระบบด้วย (`capacityKwp`, `systemSizeKWp`, `systemSizeKwp`)

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "siteId": 2,
    "projectNo": "PLANT-002",
    "projectName": "Solar Farm B",
    "systemSizeKWp": 750,
    "endWarranty": "2028-12-31T00:00:00.000Z",
    "status": "ACTIVE"
  }
}
```

#### PUT `/api/client-data/thailand/projects/:siteId`

**Headers:** `Content-Type: application/json`

**Request body (example):** (ส่งเฉพาะ field ที่อยากแก้)

```json
{ "projectName": "Solar Farm B (Updated)", "status": "MAINTENANCE" }
```

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "siteId": 2,
    "projectNo": "PLANT-002",
    "projectName": "Solar Farm B (Updated)",
    "systemSizeKWp": 750,
    "endWarranty": "2028-12-31T00:00:00.000Z",
    "status": "MAINTENANCE"
  }
}
```

#### DELETE `/api/client-data/thailand/projects/:siteId`

**Response 200 (example):**

```json
{ "success": true }
```

### PowerVault Service - Entries

#### GET `/api/client-data/service/entries`

**Query params (optional):**

- `projectNo`, `projectName`, `systemSizeKWp`
- `job` (`SERVICE | CLEANING | INSPECTION | OM`)
- `page`, `pageSize`

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "items": [
      {
        "entryId": 100,
        "siteId": 1,
        "projectNo": "PLANT-001",
        "projectName": "Solar Farm A",
        "systemSizeKWp": 500,
        "job": "SERVICE",
        "description": "Replace inverter fan",
        "createdAt": "2026-03-03T01:00:00.000Z"
      }
    ]
  }
}
```

#### POST `/api/client-data/service/entries`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{ "siteId": 1, "job": "SERVICE", "description": "Replace inverter fan" }
```

**Response 200 (example):**

```json
{ "success": true, "data": { "id": 100, "siteId": 1, "job": "SERVICE", "description": "Replace inverter fan" } }
```

#### PUT `/api/client-data/service/entries/:entryId`

**Request body (example):**

```json
{ "description": "Replace inverter fan (done)" }
```

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "id": 100,
    "siteId": 1,
    "job": "SERVICE",
    "description": "Replace inverter fan (done)"
  }
}
```

#### DELETE `/api/client-data/service/entries/:entryId`

**Response 200 (example):**

```json
{ "success": true }
```

### Project Detail (Tabs)

#### GET `/api/client-data/projects/:siteId`

**Description:** ดึงข้อมูล project + ทุก tab (warranty/layouts/forecast/other/serviceEntries)

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "plantCode": "PLANT-001",
    "name": "Solar Farm A",
    "capacityKWp": 500,
    "warrantySupplierItems": [],
    "warrantyCustomerItems": [],
    "layouts": [],
    "forecastMonthly": [],
    "forecastYearly": [],
    "otherRows": [],
    "serviceEntries": []
  }
}
```

### Warranty

#### POST `/api/client-data/projects/:siteId/warranty/supplier`

**Request body (example):**

```json
{
  "category": "INVERTER",
  "itemName": "Inverter",
  "supplierName": "Huawei",
  "productName": "SUN2000",
  "quantity": 10,
  "startWarranty": "2026-01-01",
  "endWarranty": "2031-01-01",
  "warrantyYears": 5
}
```

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "id": 10,
    "siteId": 1,
    "category": "INVERTER",
    "itemName": "Inverter",
    "supplierName": "Huawei",
    "productName": "SUN2000",
    "quantity": 10,
    "startWarranty": "2026-01-01",
    "endWarranty": "2031-01-01",
    "warrantyYears": 5
  }
}
```

#### PUT `/api/client-data/warranty/supplier/:itemId`

**Request body (example):**

```json
{ "supplierName": "Huawei (TH)", "warrantyYears": 6 }
```

#### DELETE `/api/client-data/warranty/supplier/:itemId`

**Response 200 (example):**

```json
{ "success": true }
```

#### POST `/api/client-data/projects/:siteId/warranty/customer`

**Request body (example):**

```json
{ "category": "SYSTEM", "itemName": "System warranty", "warrantyYears": 1 }
```

#### PUT `/api/client-data/warranty/customer/:itemId`

**Request body (example):**

```json
{ "warrantyYears": 2 }
```

#### DELETE `/api/client-data/warranty/customer/:itemId`

**Response 200 (example):**

```json
{ "success": true }
```

### Layouts (Upload)

#### POST `/api/client-data/projects/:siteId/layouts/:type`

**Content-Type:** `multipart/form-data`

**Path params:** `type` = `PV_LAYOUT` หรือ `PV_STRING_LAYOUT`

**File field:** `file` (single)

**Response 200 (example):**

```json
{ "success": true, "data": { "id": 1, "siteId": 1, "type": "PV_LAYOUT", "fileUrl": "/uploads/layout.pdf" } }
```

### Forecast

#### PUT `/api/client-data/projects/:siteId/forecast/pvsyst`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{
  "rows": [
    { "month": 1, "globalKwhM2": 5.1, "eGridKwh": 2500, "prRatio": 48 },
    { "month": 2, "globalKwhM2": 5.3, "eGridKwh": 2400, "prRatio": 47 }
  ]
}
```

รองรับ key alias ของ array ด้วย: `forecastRows`, `forecastMonthlyRows`, `forecast`, `rows`

**Response 200 (example):**

```json
{
  "success": true,
  "data": [
    { "siteId": 1, "month": 1, "globalKwhM2": 5.1, "eGridKwh": 2500, "prRatio": 48 }
  ]
}
```

#### PUT `/api/client-data/projects/:siteId/forecast/warranty-energy`

**Request body (example):**

```json
{ "rows": [{ "year": 2026, "degradationPct": 0.5, "annualProductionKwh": 250000, "warrantyEnergyOutputKwh": 248000 }] }
```

**Response 200 (example):**

```json
{ "success": true }
```

#### POST `/api/client-data/projects/:siteId/forecast/defaults`

**Description:** regenerate ค่า forecast รายเดือน default 12 เดือน (ลบของเดิมแล้วสร้างใหม่)

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "created": true,
    "rows": [
      { "siteId": 1, "month": 1, "globalKwhM2": 0, "eGridKwh": 0, "prRatio": 0 }
    ]
  }
}
```

### Other tab

#### POST `/api/client-data/projects/:siteId/other`

**Request body (example):**

```json
{ "status": "OPEN", "description": "Some text", "remark": "..." }
```

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "siteId": 1,
    "status": "OPEN",
    "description": "Some text",
    "remark": "..."
  }
}
```

#### PUT `/api/client-data/other/:rowId`

**Request body (example):**

```json
{ "status": "DONE", "description": "Updated" }
```

#### DELETE `/api/client-data/other/:rowId`

**Response 200 (example):**

```json
{ "success": true }
```

### Plants (Client-Only Projects)

> โมดูลนี้ใช้สร้าง Project Plant ที่เป็นข้อมูลฝั่ง Client Data เท่านั้น — **ไม่ถูกรวมเข้าหน้า Monitoring** และ **ไม่เข้าระบบ Sync กับ Huawei**
>
> ข้อมูลจะถูกเก็บใน `Site` table เดียวกัน โดยมี flag `isClientOnly = true` แยกออกจาก site ปกติ

#### GET `/api/client-data/plants`

**Query params (optional):**

| param | type | description |
|---|---|---|
| `projectNo` | string | ค้นหาด้วย plantCode (contains, case-insensitive) |
| `projectName` | string | ค้นหาด้วยชื่อโครงการ |
| `company` | string | ค้นหาด้วยชื่อบริษัท |
| `status` | string | `ACTIVE` / `INACTIVE` / `MAINTENANCE` |
| `page` | number | default 1 |
| `pageSize` | number | default 10, max 100 |

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "page": 1,
    "pageSize": 10,
    "total": 1,
    "items": [
      {
        "siteId": 300,
        "projectNo": "PRJ-2024-001",
        "projectName": "Solar Farm Bangkok",
        "company": "PowerVault Thailand",
        "type": "Solar Photovoltaic",
        "systemSizeKWp": 500,
        "locationProvince": "Bangkok",
        "codDate": "2024-06-15T00:00:00.000Z",
        "status": "ACTIVE",
        "createdAt": "2026-03-24T13:06:00.000Z"
      }
    ]
  }
}
```

#### GET `/api/client-data/plants/:siteId`

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "siteId": 300,
    "projectNo": "PRJ-2024-001",
    "projectName": "Solar Farm Bangkok",
    "company": "PowerVault Thailand",
    "ecpPpa": "CONTRACT-REF-001",
    "type": "Solar Photovoltaic",
    "address": "123 ถนนพระราม 9",
    "locationProvince": "Bangkok",
    "freeOmText": "2 Years / 4 Times",
    "warrantyOutputPct": 98,
    "codDate": "2024-06-15T00:00:00.000Z",
    "systemSizeKWp": 500,
    "solarPanel": "Jinko Tiger Neo",
    "panelBrand": "Jinko Solar",
    "panelSizeW": 580,
    "salePerson": "สมชาย ใจดี",
    "siteEngineer": "วิศวกร ทดสอบ",
    "installationContractor": "บริษัท ติดตั้ง จำกัด",
    "workEntryConditions": "สวมหมวกนิรภัย, รองเท้าเซฟตี้",
    "contactEmail": "client@example.com",
    "contactPhone": "+66-81-234-5678",
    "status": "ACTIVE",
    "createdAt": "2026-03-24T13:06:00.000Z"
  }
}
```

#### POST `/api/client-data/plants`

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{
  "projectNo": "PRJ-2024-001",
  "projectName": "Solar Farm Bangkok",
  "companyName": "PowerVault Thailand",
  "ecpPpa": "CONTRACT-REF-001",
  "type": "Solar Photovoltaic",
  "address": "123 ถนนพระราม 9",
  "locationProvince": "Bangkok",
  "freeOmText": "2 Years / 4 Times",
  "warrantyOutputPct": 98,
  "codDate": "2024-06-15",
  "systemSizeKWp": 500,
  "solarPanel": "Jinko Tiger Neo",
  "panelBrand": "Jinko Solar",
  "panelSizeW": 580,
  "salePerson": "สมชาย ใจดี",
  "siteEngineer": "วิศวกร ทดสอบ",
  "installationContractor": "บริษัท ติดตั้ง จำกัด",
  "workEntryConditions": "สวมหมวกนิรภัย, รองเท้าเซฟตี้",
  "contactEmail": "client@example.com",
  "contactPhone": "+66-81-234-5678"
}
```

> **Required fields:** `projectNo` (plantCode), `projectName` (name)
>
> `systemSizeKWp` จะ default เป็น 0 ถ้าไม่ส่ง — รองรับ alias: `capacityKWp`, `capacityKwp`

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "siteId": 300,
    "projectNo": "PRJ-2024-001",
    "projectName": "Solar Farm Bangkok",
    "company": "PowerVault Thailand",
    "type": "Solar Photovoltaic",
    "systemSizeKWp": 500,
    "locationProvince": "Bangkok",
    "codDate": "2024-06-15T00:00:00.000Z",
    "status": "ACTIVE",
    "createdAt": "2026-03-24T13:06:00.000Z"
  }
}
```

**Error 409:** plantCode ซ้ำ

```json
{ "success": false, "message": "plantCode already exists" }
```

#### PUT `/api/client-data/plants/:siteId`

**Headers:** `Content-Type: application/json`

**Request body (example):** (ส่งเฉพาะ field ที่อยากแก้)

```json
{ "projectName": "Solar Farm Bangkok V2", "status": "MAINTENANCE" }
```

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "siteId": 300,
    "projectNo": "PRJ-2024-001",
    "projectName": "Solar Farm Bangkok V2",
    "company": "PowerVault Thailand",
    "type": "Solar Photovoltaic",
    "systemSizeKWp": 500,
    "locationProvince": "Bangkok",
    "codDate": "2024-06-15T00:00:00.000Z",
    "status": "MAINTENANCE"
  }
}
```

#### DELETE `/api/client-data/plants/:siteId`

**Response 200 (example):**

```json
{ "success": true }
```

> **หมายเหตุ:** ทุกเส้น GET/PUT/DELETE จะ return 404 ถ้า siteId ไม่ใช่ plant (`isClientOnly = false`) หรือไม่มีอยู่
