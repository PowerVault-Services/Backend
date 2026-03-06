# Solar Backend (Frontend API)

Backend นี้เป็น Express + Prisma + PostgreSQL และมี API สำหรับหน้า FE หลายโมดูล (homepage, monitoring, stock, jobs, report center, client data)

---

## Quick start (Install & Run)

### Prerequisites

- Node.js (แนะนำ >= 18)
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
MAIL_HOST="smtp.gmail.com"
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER="yourgmail@gmail.com"
MAIL_PASS="xxxx xxxx xxxx xxxx"  # app password
MAIL_FROM_NAME="PowerVault Service"
MAIL_FROM_EMAIL="yourgmail@gmail.com"
```

---

## Uploads (ไฟล์แนบ)

- ไฟล์ที่อัปโหลดจะถูกเก็บไว้ที่ `uploads/`
- ถูกเสิร์ฟเป็น static ผ่าน `GET /uploads/<filename>`
- ทุก endpoint ที่เป็นไฟล์ต้องส่ง `multipart/form-data`
- ชื่อ field ของไฟล์ “ต้องตรงตามที่กำหนดในแต่ละ endpoint” ไม่งั้นจะเจอ `MulterError: Unexpected field`

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

### Common HTTP errors

- `400` invalid input / missing required fields
- `404` entity not found
- `500` internal error

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
    "lastUpdatedAt": "2026-02-03T01:05:00.000Z"
  }
}
```

**Errors:**

- `400` `{ "error": "Invalid siteId" }`
- `404` `{ "error": "Site not found" }`

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

## Stock APIs (`/api/stock`)

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
- Filters (optional): `q`, `categoryId`, `unitId`, `productId`, `dateFrom`, `dateTo`

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

**Request body (optional fields):** `txDate`, `project`, `receiver`, `vendor`, `insuranceCompany`, `insuranceNo`, `note`

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
      "contractor": "Vendor X",
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
  "workTimeText": "10:00",
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
{ "success": true, "data": { "job": { "id": 123, "jobNo": "CLN-..." }, "cleaning": { "jobId": 123 } } }
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

**Files:** `files` (file[], max 10)

**Response 200 (example):**

```json
{ "success": true }
```

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

**Headers:** `Content-Type: application/json`

**Request body (example):**

```json
{
  "jobId": 123,
  "checklistJson": "[{\"item\":\"...\",\"ok\":true}]",
  "step3SummaryNote": "สรุปผล..."
}
```

**Response 200 (example):**

```json
{ "success": true }
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
{ "siteId": 1, "workDate": "2026-02-15", "workTimeText": "10:00" }
```

**Response 200 (example):**

```json
{ "success": true, "data": { "jobId": 555, "jobNo": "INSP-20260303-000001" } }
```

#### GET `/api/inspection/job/:jobId`

**Response 200 (example):**

```json
{ "success": true, "data": { "job": { "id": 555, "jobNo": "INSP-..." }, "inspection": { "jobId": 555 } } }
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

**Files:** `attachments` (file[], max 20)

**Response 200 (example):**

```json
{ "success": true }
```

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
{ "siteId": 1, "workDate": "2026-02-15", "workTimeText": "10:00", "note": "..." }
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
    }
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

**Files:** `attachments` (file[], max 20)

**Response 200 (example):**

```json
{ "success": true }
```

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

#### POST `/api/service/step3/draft`

**Content-Type:** `multipart/form-data`

**Form fields:**

- `jobId` (required)
- `metaJson` (optional): JSON string

> NOTE: `metaJson` จะถูกเก็บลง `serviceJob.step3Meta` และ backend จะพยายาม sync รายการจ่าย Stock (OUT) จาก meta ด้วย
>
> - รองรับ field array หลายชื่อ (เช่น `stockItems`, `items`, `products`, `stockUsage`, `usedStock`)
> - แต่ละ item ควรมี `{ productId, quantity }`
> - ถ้า quantity เกินคงเหลือ จะตอบ `400` เช่น `{ "success": false, "message": "insufficient stock for productId=1: onHand=10" }`
> - การเรียกซ้ำจะลบรายการ OUT เดิมที่สร้างจาก Step3 แล้วสร้างใหม่ (กันซ้ำ)

**Files:**

- `serviceReport` (file, single)
- `evidence` (file[], max 30)

**Response 200 (example):**

```json
{ "success": true }
```

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

---

## Report Center APIs (`/api/reports`)

### GET `/api/reports`

**Description:** List report documents (คืนเฉพาะ job ที่มี report แล้ว)

**Auth:** None

**Query params (optional):**

- `siteId`: number
- `startMonth`: `YYYY-MM`
- `endMonth`: `YYYY-MM`

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

**Response 200 (example):**

```json
{ "success": true }
```

#### PUT `/api/client-data/projects/:siteId/forecast/warranty-energy`

**Request body (example):**

```json
{ "rows": [{ "year": 2026, "warrantyEnergyKwh": 123456 }] }
```

**Response 200 (example):**

```json
{ "success": true }
```

### Other tab

#### POST `/api/client-data/projects/:siteId/other`

**Request body (example):**

```json
{ "title": "Note", "value": "Some text", "remark": "..." }
```

**Response 200 (example):**

```json
{
  "success": true,
  "data": {
    "id": 1,
    "siteId": 1,
    "title": "Note",
    "value": "Some text",
    "remark": "..."
  }
}
```

#### PUT `/api/client-data/other/:rowId`

**Request body (example):**

```json
{ "value": "Updated" }
```

#### DELETE `/api/client-data/other/:rowId`

**Response 200 (example):**

```json
{ "success": true }
```
