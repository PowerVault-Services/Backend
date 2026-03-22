# Solar Backend (Frontend API)

Backend นี้เป็น Express + Prisma + PostgreSQL และมี API สำหรับหน้า FE หลายโมดูล (homepage, monitoring, alarms/admin alarms, stock, jobs, report center, client data)

---

## Quick start (Install & Run)

### Prerequisites

- Node.js (แนะนำ >= 20, CI ใช้ Node 20)
- Docker Desktop / Docker Engine

### Run locally

```bash
npm install

# start postgres
docker compose up -d

# create/update database schema
npx prisma migrate dev

# seed (optional)
npx prisma db seed

# run dev
npm run dev
```

Default server: `http://localhost:3000`

---

## Environment variables (.env)

### Database

```env
DATABASE_URL="postgresql://admin:password123@localhost:5433/solar_db?schema=public"
```

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

ค่า default ปัจจุบันคือ local disk (`uploads/`) แต่โค้ดรองรับ object storage (MinIO/S3-compatible) ผ่าน gateway เดียวกัน (`/uploads/...`)

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
HUAWEI_SITE_REALTIME_CRON="*/5 * * * *"
HUAWEI_DEVICE_CRON="2-59/5 * * * *"
HUAWEI_ALARM_CRON="1-59/5 * * * *"

# watchdog: ตรวจจับ sync job ค้าง
HUAWEI_SYNC_WATCHDOG_INTERVAL_MS=60000      # ตรวจทุก 60 วินาที
HUAWEI_SYNC_WATCHDOG_STALE_MS=900000        # ถือว่าค้างเมื่อเกิน 15 นาที

# health check (/healthz)
HUAWEI_SYNC_HEALTH_MAX_LAG_MS=1200000       # lag เกิน 20 นาที = unhealthy (503)

# alarm auto-refresh cooldown (ใช้ใน /api/alarms?refresh=1)
HUAWEI_ALARM_AUTO_REFRESH_MIN_INTERVAL_MS=60000
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

## Health Check Endpoints

### GET `/healthz`

**Description:** Cron job health check — ตรวจว่า sync jobs ยังทำงานปกติ (ถ้า lag เกิน `HUAWEI_SYNC_HEALTH_MAX_LAG_MS` จะตอบ 503)

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

**Description:** สถานะ Cron jobs ทั้งหมด (site realtime, device, alarm sync)

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

**Response 200 (example):**

```json
{ "success": true }
```

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
  - เอกสารหน้าเต็ม: `CERTIFICATE` | `LAYOUT`
  - รูปตามหัวข้อหน้าเว็บ Step3.1: `BEFORE_PANEL` | `DURING_PANEL` | `AFTER_PANEL` | `BEFORE_INVERTER` | `DURING_INVERTER` | `AFTER_INVERTER` | `ZONE_WORK` | `ZONE_CHECKLIST`
  - รองรับของเดิม (เก่า): `BEFORE` | `AFTER`
  - ถ้าไม่ส่งมา จะถือเป็น `EVIDENCE`

**Files:** `files` (file[], max 30)

**Response 200 (example):**

```json
{ "success": true }
```

#### POST `/api/cleaning/step3/checklist`

บันทึกข้อมูล checklist ของงาน cleaning ซึ่งถูกนำไปใช้ใน **2 หน้า** ของ PDF report:

1. **หน้า "เอกสารส่งมอบงาน" (Certificate of Completion)** — ใช้ `items[].title`, `items[].location`, `items[].signaturePV`, `items[].signatureCustomer`, `certificateApproval`, `certificateSignature`
2. **หน้า "แผนการบำรุงรักษาเชิงป้องกัน" (Checklist)** — ใช้ `items[].title`, `items[].status`, `items[].remark`, `items[].children[]`

**Headers:** `Content-Type: application/json`

---

##### โครงสร้าง Request Body

```
{
  "jobId": number,              // (required) รหัส job
  "checklistJson": { ... },     // (required) ข้อมูล checklist ทั้งหมด — ดูด้านล่าง
  "step3SummaryNote": string    // (optional) สรุปการทำงาน step 3
}
```

##### โครงสร้าง `checklistJson`

```
{
  "items": [ ... ],                        // (required) รายการ checklist — ดูด้านล่าง
  "certificateApproval": string | null,    // (optional) ช่องติ๊กด้านบนหน้า Certificate
  "certificateSignature": { ... }          // (optional) ข้อมูลลงนามด้านล่างหน้า Certificate
}
```

---

##### `items[]` — รายการ checklist (รองรับ 2 แบบ)

ระบบรองรับ 2 format สำหรับ `items`: **แบบ flat** (ง่าย) และ **แบบ hierarchical** (จัดกลุ่ม)

ถ้ามี item ใดมี `children` → ระบบจะ render **ทุก item** แบบ hierarchical (group title + sub-items)
ถ้าไม่มี `children` เลย → render แบบ flat ปกติ

**แต่ละ item มี field ดังนี้:**

| field | type | ใช้ในหน้า | คำอธิบาย |
|-------|------|-----------|----------|
| `title` | `string` | Certificate + Checklist | ชื่อรายการ / ชื่อกลุ่ม (ถ้าเป็น hierarchical) |
| `status` | `string` | Checklist | สถานะ: `"done"`, `"pass"`, `"completed"`, `"yes"` → แสดง ✓ / ค่าอื่นแสดงตามที่ส่ง |
| `remark` | `string` | Checklist | หมายเหตุ |
| `location` | `string` | Certificate | สถานที่ทำงาน เช่น `"บนดาดฟ้า"`, `"ห้อง Inverter"` (ถ้าไม่ส่ง ใช้ค่าจาก `cleaning.locationText` หรือ `"บนดาดฟ้า"`) |
| `signaturePV` | `string` | Certificate | ชื่อผู้ลงนามฝั่ง PowerVault ในตาราง Certificate (เช่น `"สมชาย"`) |
| `signatureCustomer` | `string` | Certificate | ชื่อผู้ตรวจรับมอบงานในตาราง Certificate (เช่น `"สมหญิง"`) |
| `children` | `array` | Checklist | (optional) sub-items ของกลุ่มนี้ — แต่ละ child มี `{ title, status, remark }` |

---

##### `certificateApproval` — ช่องติ๊กอนุมัติด้านบน

ติ๊ก 1 ใน 3 ช่อง ที่ด้านบนหน้า Certificate:

| ค่า | ผลลัพธ์ใน PDF |
|-----|---------------|
| `"approval"` | [✓] อนุมัติ/ Approval &nbsp; [ ] รับทราบ &nbsp; [ ] ระบุความคิดเห็น |
| `"acknowledgement"` | [ ] อนุมัติ &nbsp; [✓] รับทราบ/ Acknowledgement &nbsp; [ ] ระบุความคิดเห็น |
| `"comment"` | [ ] อนุมัติ &nbsp; [ ] รับทราบ &nbsp; [✓] ระบุความคิดเห็น/ Comment |
| ไม่ส่ง / `null` | [ ] อนุมัติ &nbsp; [ ] รับทราบ &nbsp; [ ] ระบุความคิดเห็น (ไม่ติ๊กอะไร) |

---

##### `certificateSignature` — ข้อมูลลงนามด้านล่าง

| field | type | คำอธิบาย |
|-------|------|----------|
| `engineerName` | `string` | ชื่อวิศวกร/หัวหน้างาน (ฝั่งซ้ายล่าง) เช่น `"สมชาย ใจดี"` — ถ้าไม่ส่งแสดง `...` |
| `engineerDate` | `string` | วันที่ลงนามวิศวกร เช่น `"22/09/2568"` — ถ้าไม่ส่งแสดง `../../....` |
| `customerName` | `string` | ชื่อผู้ตรวจรับมอบงาน/ลูกค้า (ฝั่งขวาล่าง) เช่น `"สมหญิง รักสะอาด"` — ถ้าไม่ส่ง fallback ไปใช้ `cleaning.customerName` หรือแสดง `...` |
| `customerDate` | `string` | วันที่ลูกค้าลงนาม เช่น `"22/09/2568"` — ถ้าไม่ส่งแสดง `../../....` |
| `customerApproval` | `string` | ช่องติ๊กด้านขวาล่าง: `"A"` = อนุมัติ, `"AC"` = ความเห็น/ข้อควรแก้ไข, `"N"` = ไม่อนุมัติ — ถ้าไม่ส่งจะไม่ติ๊กอะไร |
| `customerNote` | `string` | Note ของลูกค้า เช่น `"ดีมาก"` — ถ้าไม่ส่งแสดง `...` |

---

##### ตัวอย่าง 1: Hierarchical checklist + Certificate ครบทุก field (แนะนำ)

ใช้เมื่อต้องการจัดกลุ่มอุปกรณ์ (เช่น แผงโซลาร์, Inverter, Monitoring) พร้อมรายการย่อย + ข้อมูลลงนามครบ

```json
{
  "jobId": 24,
  "checklistJson": {
    "items": [
      {
        "title": "แผงโซลาร์เซลล์",
        "location": "บนดาดฟ้า",
        "signaturePV": "สมชาย",
        "signatureCustomer": "สมหญิง",
        "children": [
          { "title": "ตรวจสอบความสะอาดแผงและล้างแผงโซลาร์เซลล์", "status": "done", "remark": "สะอาดเรียบร้อย" },
          { "title": "ตรวจสอบสภาพแผง สีกระจก และการเกิดออกไซด์", "status": "done", "remark": "ปกติดี" }
        ]
      },
      {
        "title": "Inverter Unit",
        "location": "ห้อง Inverter",
        "signaturePV": "สมชาย",
        "signatureCustomer": "สมหญิง",
        "children": [
          { "title": "ตรวจสอบสภาพและทำความสะอาด Filter", "status": "done", "remark": "สะอาดเรียบร้อย" }
        ]
      },
      {
        "title": "ตรวจสอบ Monitoring System",
        "location": "ห้องควบคุม",
        "signaturePV": "สมชาย",
        "signatureCustomer": "สมหญิง",
        "children": [
          { "title": "ตรวจสอบสภาพตู้ควบคุม", "status": "done", "remark": "ปกติ" }
        ]
      }
    ],
    "certificateApproval": "approval",
    "certificateSignature": {
      "engineerName": "สมชาย ใจดี",
      "engineerDate": "22/09/2568",
      "customerName": "สมหญิง รักสะอาด",
      "customerDate": "22/09/2568",
      "customerApproval": "A",
      "customerNote": ""
    }
  },
  "step3SummaryNote": "ล้างแผงเสร็จเรียบร้อย ไม่พบความเสียหาย"
}
```

> **ผลลัพธ์ในหน้า "แผนการบำรุงรักษา" (Checklist):**
>
> | ลำดับ | อุปกรณ์/รายการ | การดำเนินการ | หมายเหตุ |
> |-------|---------------|-------------|----------|
> | 1 | **แผงโซลาร์เซลล์** | | |
> | | - ตรวจสอบความสะอาดแผงฯ | ✓ | สะอาดเรียบร้อย |
> | | - ตรวจสอบสภาพแผงฯ | ✓ | ปกติดี |
> | 2 | **Inverter Unit** | | |
> | | - ตรวจสอบสภาพฯ | ✓ | สะอาดเรียบร้อย |
> | 3 | **ตรวจสอบ Monitoring System** | | |
> | | - ตรวจสอบสภาพตู้ควบคุม | ✓ | ปกติ |
>
> **ผลลัพธ์ในหน้า "เอกสารส่งมอบงาน" (Certificate):**
>
> | ลำดับ | รายละเอียดงาน | สถานที่ทำงาน | ลงนาม/Signature PV | ผู้ตรวจรับมอบงาน |
> |-------|--------------|-------------|-------------------|----------------|
> | 1 | - แผงโซลาร์เซลล์ | บนดาดฟ้า | สมชาย | สมหญิง |
> | 2 | - Inverter Unit | ห้อง Inverter | สมชาย | สมหญิง |
> | 3 | - ตรวจสอบ Monitoring System | ห้องควบคุม | สมชาย | สมหญิง |

---

##### ตัวอย่าง 2: Flat checklist (ไม่จัดกลุ่ม) + ไม่มี Certificate data

ใช้เมื่อ checklist เป็นรายการเดี่ยวๆ ไม่มี sub-items และไม่ต้องการกรอก Certificate (จะแสดงเป็นช่องว่าง `...`)

```json
{
  "jobId": 24,
  "checklistJson": {
    "items": [
      { "title": "ตรวจสอบสภาพแผงโซลาร์ก่อนล้าง", "status": "done", "remark": "-" },
      { "title": "ฉีดล้างแผงด้วยน้ำสะอาด", "status": "done", "remark": "-" },
      { "title": "ตรวจสอบสายไฟและจุดเชื่อมต่อ", "status": "done", "remark": "ไม่พบความผิดปกติ" },
      { "title": "ตรวจสอบ Inverter", "status": "done", "remark": "ทำงานปกติ" },
      { "title": "ตรวจสอบระบบสายดิน", "status": "pass", "remark": "-" }
    ]
  }
}
```

> **ผลลัพธ์ในหน้า Checklist:** แต่ละ item เป็นแถวเดี่ยวๆ (ไม่มีกลุ่ม ไม่มีตัวหนา)
>
> **ผลลัพธ์ในหน้า Certificate:**
> - ช่องติ๊กด้านบน: ไม่ติ๊กอะไร
> - ตารางแสดง: title จาก items, location fallback เป็น `"บนดาดฟ้า"`, ช่องลงนาม/ผู้ตรวจเป็นว่าง
> - ด้านล่าง: ชื่อวิศวกร/ลูกค้า/วันที่แสดงเป็น `...`

---

##### ตัวอย่าง 3: Hierarchical checklist + Certificate บางส่วน

ใช้เมื่อมีข้อมูลวิศวกรแล้ว แต่ลูกค้ายังไม่ลงนาม

```json
{
  "jobId": 24,
  "checklistJson": {
    "items": [
      {
        "title": "แผงโซลาร์เซลล์",
        "location": "บนดาดฟ้า",
        "signaturePV": "สมชาย",
        "children": [
          { "title": "ล้างแผงโซลาร์เซลล์", "status": "done", "remark": "เรียบร้อย" }
        ]
      },
      {
        "title": "Inverter Unit",
        "location": "ห้อง Inverter",
        "signaturePV": "สมชาย",
        "children": [
          { "title": "ทำความสะอาด Filter", "status": "done", "remark": "เรียบร้อย" }
        ]
      }
    ],
    "certificateApproval": "approval",
    "certificateSignature": {
      "engineerName": "สมชาย ใจดี",
      "engineerDate": "15/02/2569"
    }
  }
}
```

> **ผลลัพธ์ในหน้า Certificate:**
> - [✓] อนุมัติ
> - ตาราง: signaturePV = "สมชาย", ช่อง ผู้ตรวจรับมอบงาน = ว่าง (ไม่ได้ส่ง `signatureCustomer`)
> - วิศวกร: สมชาย ใจดี / 15/02/2569
> - ลูกค้า: ชื่อ = `...`, วันที่ = `../../....`, ช่องติ๊ก A/AC/N = ไม่ติ๊ก

---

##### ตัวอย่าง 4: ลูกค้าไม่อนุมัติ + มี Note

```json
{
  "jobId": 24,
  "checklistJson": {
    "items": [
      {
        "title": "แผงโซลาร์เซลล์",
        "location": "บนดาดฟ้า",
        "signaturePV": "สมชาย",
        "signatureCustomer": "สมหญิง",
        "children": [
          { "title": "ล้างแผง", "status": "done", "remark": "" }
        ]
      }
    ],
    "certificateApproval": "comment",
    "certificateSignature": {
      "engineerName": "สมชาย ใจดี",
      "engineerDate": "15/02/2569",
      "customerName": "สมหญิง รักสะอาด",
      "customerDate": "15/02/2569",
      "customerApproval": "N",
      "customerNote": "ยังล้างไม่สะอาด ต้องกลับมาทำใหม่"
    }
  }
}
```

> **ผลลัพธ์ในหน้า Certificate:**
> - [ ] อนุมัติ &nbsp; [ ] รับทราบ &nbsp; [✓] ระบุความคิดเห็น
> - ด้านล่างฝั่งลูกค้า: [✓] N - ไม่อนุมัติ, Note: ยังล้างไม่สะอาด ต้องกลับมาทำใหม่

---

##### ตัวอย่าง 5: Minimal (เฉพาะ checklist ไม่มี certificate เลย)

ใช้เมื่อต้องการบันทึกแค่ข้อมูล checklist โดยไม่สนหน้า Certificate

```json
{
  "jobId": 24,
  "checklistJson": {
    "items": [
      { "title": "ล้างแผง", "status": "done", "remark": "เรียบร้อย" },
      { "title": "ตรวจ Inverter", "status": "done", "remark": "ปกติ" }
    ]
  }
}
```

> หน้า Certificate จะแสดงช่องว่าง `...` ทุกช่อง ไม่ติ๊กอะไร — เหมาะสำหรับพิมพ์แล้วกรอกด้วยมือ

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

**Response 200 (example):**

```json
{
  "success": true,
  "data": { "reportUrl": "/uploads/report.pdf", "download": "/api/cleaning/step4/download/123" }
}
```

> NOTE: ถ้ารูป/ไฟล์บางส่วนหาไม่เจอระหว่าง generate report ระบบจะข้ามไฟล์นั้นและอาจส่ง `warning.missing` กลับมา

**โครงสร้างหน้า PDF ที่ generate ได้:**

| ลำดับ | หน้า | แหล่งข้อมูล |
|-------|------|-------------|
| 1 | ปกรายงาน (Cover) | jobNo, projectName, workDate |
| 2 | เอกสารส่งมอบงาน (Certificate of Completion) | สร้างจาก checklist items + `certificateApproval` + `certificateSignature` |
| 3 | Layout โครงการ (PV Layout) | ดึงจาก `SiteLayout` (client data, type=`PV_LAYOUT`) — แสดงเฉพาะเมื่อมีรูป |
| 4 | Legacy full-page docs | STEP3_CERTIFICATE / STEP3_LAYOUT attachments (backward compat) |
| 5 | แผนการบำรุงรักษาเชิงป้องกัน (Checklist) | `cleaningJob.checklist` JSON — รองรับทั้ง flat และ hierarchical |
| 6+ | รูปภาพหลักฐาน (Evidence) | JobAttachment ที่ fileType ขึ้นต้นด้วย `STEP3_` |

> หน้า Certificate จะแสดงเมื่อ checklist มี items — ข้อมูลส่งผ่าน `checklistJson` ตอน step3 (ดูตัวอย่างที่ `POST /api/cleaning/step3/checklist`)
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

**Response 200 (example):**

```json
{ "success": true }
```

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

**Response 200 (example):**

```json
{ "success": true }
```

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

**Response 200 (example):**

```json
{ "success": true }
```

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

**Response 200 (example):**

```json
{ "success": true }
```

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

บันทึกข้อมูล Service Report (Step3) ซึ่งถูกนำไปใช้ใน **2 ส่วน** ของ PDF report:

1. **หน้า "Service Report Form" (หน้า 1)** — สร้าง digital form อัตโนมัติจาก `metaJson` ร่วมกับข้อมูล Step1 (projectName, workDate, systemSize ฯลฯ)
2. **หน้า "รูปภาพประกอบ" (หน้า 2+)** — แสดงรูป `evidence` ในตาราง 2x2 (สูงสุด 4 รูป/หน้า, รวมไม่เกิน 12 รูป)

**Content-Type:** `multipart/form-data`

---

##### Form Fields

| field | type | required | คำอธิบาย |
|-------|------|----------|----------|
| `jobId` | `number` | ✅ | รหัส job |
| `metaJson` | `string (JSON)` | optional | JSON string ข้อมูลรายละเอียดงานบริการ — ดูโครงสร้างด้านล่าง |

##### Files (multipart)

| field name | type | คำอธิบาย |
|------------|------|----------|
| `serviceReport` | file (single) | (optional, ไม่ใช้ใน PDF แล้ว) เก็บรูปใบ Service Report เขียนมือเป็น archive เท่านั้น — PDF ใช้ digital form จาก `metaJson` แทน |
| `evidence` | file[] (max 30) | รูปภาพหลักฐานการปฏิบัติงาน — แสดงเป็นตาราง 2x2 ในหน้าถัดๆ ไป |

---

##### โครงสร้าง `metaJson`

`metaJson` เป็น JSON string ที่ frontend ส่งมา — backend จะ parse แล้วเก็บลง `serviceJob.step3Meta` ทั้งก้อน

```
{
  "serviceType": string,         // ลักษณะงานบริการ → ใช้ติ๊ก checkbox + fallback ชื่อรายการในตาราง
  "technicianName": string,      // ชื่อ-นามสกุล ผู้เข้าตรวจสอบ
  "technicianPosition": string,  // ตำแหน่ง (default: "Service Technician")
  "projectType": string,         // ประเภทโครงการ → ติ๊ก checkbox (Solar Rooftop/Farm/Floating)
  "startDate": string,           // วันที่เริ่มเข้าดำเนินการ
  "endDate": string,             // วันที่เสร็จสิ้นงาน
  "customerName": string,        // ชื่อผู้รับรอง (ฝั่งลูกค้า)
  "customerPosition": string,    // สถานภาพ/ตำแหน่ง ผู้รับรอง
  "summary": string,             // หมายเหตุ
  "tasks": [ ... ],              // รายการงาน → ตารางลำดับ/รายการ/รายละเอียด
  "stockItems": [ ... ]          // อุปกรณ์/อะไหล่ที่ใช้ → สร้าง Stock OUT + แสดงตาราง
}
```

> **หมายเหตุ:** Backend รองรับ field name หลายรูปแบบเพื่อความยืดหยุ่น:
> - `serviceType` หรือ `serviceName` / `jobType` / `title`
> - `technicianName` หรือ `technician` / `serviceBy` / `operatorName` / `staffName`
> - `technicianPosition` หรือ `position` / `staffPosition`
> - `startDate` หรือ `serviceStartDate` / `workStartDate`
> - `endDate` หรือ `serviceEndDate` / `workEndDate`
> - `customerName` หรือ `customerSigner` / `approverName` / `ownerName`
> - `customerPosition` หรือ `approverPosition` / `ownerPosition`
> - `summary` หรือ `remark` / `description` / `details`
> - `tasks` หรือ `details` / `checklist` / `items` / `works`
> - `stockItems` หรือ `stock` / `items` / `products` / `stockUsage` / `usedStock`

---

##### `tasks[]` — รายการงาน

แต่ละ task แสดงเป็น 1 แถวในตาราง "รายการ" ของ PDF หน้าแรก

| field | type | คำอธิบาย |
|-------|------|----------|
| `name` | `string` | ชื่อรายการงาน (รองรับ: `name`, `title`, `topic`, `item`, `description`) |
| `detail` | `string` | รายละเอียด/วิธีดำเนินการ (รองรับ: `detail`, `remark`, `result`, `note`) |

ถ้าไม่ส่ง `tasks` → backend ใช้ `serviceType` เป็นชื่อรายการ 1 แถว + `summary` เป็นรายละเอียด

ถ้า task เป็น string ธรรมดา (ไม่ใช่ object) → ใช้เป็นชื่อรายการ ช่องรายละเอียดว่าง

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

##### `metaJson` fields → ผลลัพธ์ในหน้า PDF

| field | ตำแหน่งใน PDF | ค่า default ถ้าไม่ส่ง |
|-------|--------------|----------------------|
| `projectType` | ช่อง checkbox "ลักษณะงานติดตั้ง" → ติ๊ก Solar Rooftop / Farm / Floating | ติ๊ก Solar Rooftop |
| `serviceType` | ช่อง checkbox "ลักษณะงานบริการ" → ติ๊กตาม keyword (ดูตารางด้านล่าง) + ชื่อรายการ fallback ในตาราง | ไม่ติ๊กอะไร |
| `technicianName` | "ชื่อ-นามสกุล (ผู้เข้าตรวจสอบ)" | แสดง `-` |
| `technicianPosition` | "ตำแหน่ง" + "สถานภาพ / ตำแหน่ง" ในช่องลงนามฝั่งซ้าย | `Service Technician` |
| `tasks` | ตาราง (ลำดับ / รายการ / รายละเอียด) | 1 แถว: ชื่อ=`serviceType` หรือ "งานบริการ", รายละเอียด=`summary` |
| `summary` | "หมายเหตุ :" ด้านล่างตาราง | ว่าง (ใช้ `note` จาก Step1 ถ้ามี) |
| `startDate` | "วันที่เริ่มเข้าดำเนินการ" ในช่องลงนาม | ใช้ `workDate` จาก Step1 (format ไทย) |
| `endDate` | "วันที่เสร็จสิ้นงาน" ในช่องลงนาม | ใช้ `workDate` จาก Step1 (format ไทย) |
| `customerName` | "ลงชื่อผู้รับรอง" ในช่องลงนามฝั่งขวา | ว่าง |
| `customerPosition` | "สถานภาพ / ตำแหน่ง" ในช่องลงนามฝั่งขวา | ว่าง |
| `stockItems` | ตาราง "รายการอุปกรณ์/อะไหล่ที่ใช้" (SKU/หมวดหมู่/รายการ/หน่วย/จำนวน) | ไม่แสดงตาราง |

---

##### `serviceType` → Checkbox mapping

Backend จะเทียบ keyword ใน `serviceType` เพื่อติ๊ก checkbox "ลักษณะงานบริการ":

| keyword (case-insensitive) | ช่องที่ติ๊ก |
|----------------------------|------------|
| `ติดตั้ง`, `install` | ✓ งานติดตั้ง |
| `เปิดระบบ`, `commission` | ✓ งานเปิดระบบ |
| `inspect`, `ตรวจ` | ✓ ตรวจสอบโครงการ |
| `maintenance`, `บำรุง`, `ซ่อม`, `service` | ✓ การซ่อมบำรุง |
| `other`, `อื่น`, `เพิ่มเติม` | ✓ งานเพิ่มเติม |

##### `projectType` → Checkbox mapping

| keyword (case-insensitive) | ช่องที่ติ๊ก |
|----------------------------|------------|
| `roof`, `rooftop` | ✓ Solar Rooftop |
| `farm` | ✓ Solar Farm |
| `floating` | ✓ Solar Floating |
| ไม่ส่ง / ค่าอื่น | ✓ Solar Rooftop (default) |

---

##### ตัวอย่าง 1: ครบทุก field (แนะนำ)

งาน Maintenance มีรายการงาน 2 รายการ + อะไหล่ที่ใช้ + ข้อมูลลงนาม

```json
// metaJson (ส่งเป็น string ใน form field)
{
  "serviceType": "การซ่อมบำรุง",
  "projectType": "Solar Rooftop",
  "technicianName": "กิตติพงษ์ กุลไพร",
  "technicianPosition": "Service Technician",
  "startDate": "14 พ.ค. 2568",
  "endDate": "14 พ.ค. 2568",
  "customerName": "สิทธิพงษ์",
  "customerPosition": "",
  "summary": "",
  "tasks": [
    {
      "name": "เปลี่ยนพัดลม",
      "detail": "INV 1 = 30\nINV 2 = 30\nINV 3 = 30\nINV 4 = 30\nINV 5 = 30\nจำนวนรวม 150 ตัว"
    }
  ],
  "stockItems": [
    { "productId": 5, "quantity": 150 }
  ]
}
```

> **ผลลัพธ์ใน PDF (หน้า 1 — Service Report Form):**
>
> ```
> โครงการ: Thai Nokoan Srimahapo     วันที่ 14 เดือน พ.ค. ปี 2568
>
> ลักษณะงานติดตั้ง:  [✓] Solar Rooftop  [ ] Solar Farm  [ ] Solar Floating
> ลักษณะงานบริการ:  [ ] งานติดตั้ง  [ ] งานเปิดระบบ  [ ] ตรวจสอบโครงการ  [✓] การซ่อมบำรุง  [ ] งานเพิ่มเติม
>
> ชื่อ-นามสกุล (ผู้เข้าตรวจสอบ): กิตติพงษ์ กุลไพร
> ตำแหน่ง: Service Technician
>
> | ลำดับ | รายการ     | รายละเอียด / วิธีดำเนินการ          |
> |-------|-----------|-------------------------------------|
> | 1     | เปลี่ยนพัดลม | INV 1 = 30, INV 2 = 30, ... รวม 150 |
>
> รายการอุปกรณ์/อะไหล่ที่ใช้:
> | SKU   | หมวดหมู่ | รายการ      | หน่วย | จำนวน |
> | FAN01 | พัดลม   | พัดลม INV   | ตัว   | 150   |
>
> หมายเหตุ:
>
> วันที่เริ่มเข้าดำเนินการ: 14 พ.ค. 2568    วันที่เสร็จสิ้นงาน: 14 พ.ค. 2568
> ลงชื่อผู้ตรวจสอบ:                         ลงชื่อผู้รับรอง:
> ตำแหน่ง: Service Technician               สถานภาพ:
> หน่วยงาน: บริษัท พาวเวอร์วอลท์ฯ            หน่วยงาน:
> ลายเซ็น:                                 ลายเซ็น:
> ```

**Postman form-data fields:**

| Key | Type | Value |
|-----|------|-------|
| `jobId` | Text | `777` |
| `metaJson` | Text | `{"serviceType":"การซ่อมบำรุง","projectType":"Solar Rooftop","technicianName":"กิตติพงษ์ กุลไพร","technicianPosition":"Service Technician","startDate":"14 พ.ค. 2568","endDate":"14 พ.ค. 2568","customerName":"สิทธิพงษ์","tasks":[{"name":"เปลี่ยนพัดลม","detail":"INV 1 = 30\nINV 2 = 30\nINV 3 = 30"}],"stockItems":[{"productId":5,"quantity":150}]}` |
| `evidence` | File | `photo1.jpg` |
| `evidence` | File | `photo2.jpg` |
| `evidence` | File | `photo3.jpg` |
| `evidence` | File | `photo4.jpg` |

---

##### ตัวอย่าง 2: Minimal — เฉพาะ tasks ไม่มีข้อมูลเพิ่มเติม

ใช้เมื่อต้องการบันทึกแค่รายการงาน ไม่มี stock ไม่มีข้อมูลลงนาม

```json
{
  "serviceType": "maintenance",
  "technicianName": "สมชาย",
  "tasks": [
    { "name": "ตรวจสอบ Inverter", "detail": "ทำงานปกติ" },
    { "name": "ตรวจสอบสายไฟ", "detail": "ไม่พบความผิดปกติ" }
  ]
}
```

> **ผลลัพธ์ใน PDF:**
> - ติ๊ก ✓ การซ่อมบำรุง (keyword "maintenance")
> - ติ๊ก ✓ Solar Rooftop (default เมื่อไม่ส่ง projectType)
> - ตาราง 2 แถว: ตรวจสอบ Inverter, ตรวจสอบสายไฟ
> - ไม่มีตาราง Stock
> - วันที่เริ่ม/เสร็จ = workDate จาก Step1 (format ไทย)
> - ช่องลงนามฝั่งลูกค้า = ว่าง

---

##### ตัวอย่าง 3: งานตรวจสอบโครงการ + Solar Farm + หมายเหตุ

```json
{
  "serviceType": "ตรวจสอบโครงการ",
  "projectType": "Solar Farm",
  "technicianName": "วิศวกร สมใจ",
  "technicianPosition": "Senior Engineer",
  "startDate": "1 มี.ค. 2569",
  "endDate": "2 มี.ค. 2569",
  "customerName": "คุณประสิทธิ์",
  "customerPosition": "ผู้จัดการโรงงาน",
  "summary": "ตรวจสอบทุกจุดเรียบร้อย ไม่พบปัญหา",
  "tasks": [
    { "name": "ตรวจสภาพแผงโซลาร์", "detail": "ปกติ ไม่มีรอยแตก" },
    { "name": "ตรวจสอบ Inverter", "detail": "LED ปกติทุกตัว" },
    { "name": "ตรวจสอบ Combiner Box", "detail": "Fuse ครบ ไม่มีรอยไหม้" },
    { "name": "วัดค่า String Voltage", "detail": "Voc ปกติทุก String" }
  ]
}
```

> **ผลลัพธ์ใน PDF:**
> - ติ๊ก ✓ Solar Farm
> - ติ๊ก ✓ ตรวจสอบโครงการ (keyword "ตรวจ")
> - ชื่อ: วิศวกร สมใจ / ตำแหน่ง: Senior Engineer
> - ตาราง 4 แถว
> - หมายเหตุ: ตรวจสอบทุกจุดเรียบร้อย ไม่พบปัญหา
> - วันที่เริ่ม: 1 มี.ค. 2569 / วันที่เสร็จ: 2 มี.ค. 2569
> - ผู้รับรอง: คุณประสิทธิ์ / ผู้จัดการโรงงาน

---

##### ตัวอย่าง 4: ไม่ส่ง metaJson เลย (ใช้แค่ไฟล์)

ใช้เมื่อ frontend ไม่มีฟอร์มกรอกข้อมูล แค่อัปโหลดรูป service report + evidence

```
POST /api/service/step3/draft
Content-Type: multipart/form-data

jobId: 777
serviceReport: [file: service-form-scan.jpg]
evidence: [file: photo1.jpg]
evidence: [file: photo2.jpg]
```

> **ผลลัพธ์ใน PDF:**
> - หน้า 1 (Service Report Form): ข้อมูลจาก Step1 (projectName, workDate, systemSize) + ช่อง checkbox/ตาราง/ลงนาม เป็นค่า default ทั้งหมด
> - หน้า 2: รูป service-form-scan.jpg เต็มหน้า (ใบ Service Report ที่เขียนด้วยมือ)
> - หน้า 3: รูป evidence 2 รูปในตาราง 2x2

---

##### ตัวอย่าง 5: ส่ง tasks เป็น string array (simplified)

```json
{
  "serviceType": "งานติดตั้ง",
  "technicianName": "สมศักดิ์ ดีงาม",
  "tasks": [
    "ติดตั้งแผงโซลาร์เซลล์",
    "ต่อสาย DC String",
    "ติดตั้ง Inverter",
    "เปิดระบบทดสอบ"
  ]
}
```

> **ผลลัพธ์ใน PDF:**
> - ติ๊ก ✓ งานติดตั้ง
> - ตาราง 4 แถว: ชื่อรายการ = string ที่ส่ง, ช่องรายละเอียด = ว่าง
>
> | ลำดับ | รายการ                  | รายละเอียด / วิธีดำเนินการ |
> |-------|------------------------|---------------------------|
> | 1     | ติดตั้งแผงโซลาร์เซลล์      |                           |
> | 2     | ต่อสาย DC String        |                           |
> | 3     | ติดตั้ง Inverter         |                           |
> | 4     | เปิดระบบทดสอบ           |                           |

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

**Response 200 (example):**

```json
{ "success": true, "data": { "reportUrl": "/uploads/report.pdf", "download": "/api/service/step4/download/777" } }
```

> NOTE: ถ้ารูป/ไฟล์บางส่วนหาไม่เจอระหว่าง generate report ระบบจะข้ามไฟล์นั้น

**โครงสร้างหน้า PDF ที่ generate ได้:**

| ลำดับ | หน้า | แหล่งข้อมูล |
|-------|------|-------------|
| 1 | Service Report Form (digital) | ข้อมูล Step1 (projectName, workDate, systemSize) + `step3Meta` (tasks, technician, signatures, stock) — สร้างอัตโนมัติจากข้อมูลที่กรอก |
| 2+ | รูปภาพประกอบการปฏิบัติงาน | `SERVICE_EVIDENCE` attachments — ตาราง 2x2 สูงสุด 4 รูป/หน้า (รวมไม่เกิน 12 รูป) |

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

**Response 200 (example):**

```json
{ "success": true }
```

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
