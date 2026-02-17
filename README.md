# Frontend API Documentation


## install&run

```bash
npm install
docker compose up -d
npx prisma generate
npm run dev
```

---

## ตั้งค่า .env ที่สำคัญ

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

### Email (ส่งออก Gmail จริง)

โปรเจกต์นี้ใช้ SMTP (nodemailer) — ถ้าอยากส่งผ่าน Gmail:

1) เปิด 2-Step Verification ใน Gmail
2) สร้าง **App Password** (Mail)
3) ใส่ env ประมาณนี้:

```env
MAIL_HOST="smtp.gmail.com"
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER="yourgmail@gmail.com"
MAIL_PASS="xxxx xxxx xxxx xxxx"  # app password
MAIL_FROM_NAME="PowerVault Service"
MAIL_FROM_EMAIL="yourgmail@gmail.com"
```

ถ้าเจอ error `ECONNREFUSED 127.0.0.1:587` แปลว่า env ยังชี้ไป host ฝั่ง local (เช่น mailhog) หรือ service smtp ไม่ได้รัน

---

## 4) Uploads (ไฟล์แนบ)

ไฟล์ที่อัปโหลดจะถูกเก็บไว้ในโฟลเดอร์ `uploads/` และถูกเสิร์ฟผ่าน path `/uploads/...`

ข้อสำคัญใน Postman/FE:
- ต้องส่งเป็น `multipart/form-data`
- **Field name ต้องตรงกับ route** (ดูตารางใน docs)

---

This document describes the current backend API for:
- Homepage module (`/api/homepage`)
- Monitoring module (`/api/monitoring`)
- Stock module (`/api/stock`)

## 1) Base Configuration
-
### Response shape note

There are 2 response styles in current code:

1. `homepage` and `stock` mostly return:
```json
{
  "success": true,
  "data": {}
}
```

2. `monitoring` returns:
```json
{
  "data": {}
}
```

Error payloads are not fully unified across all modules yet.

---

## 2) Homepage APIs (`/api/homepage`)

### 2.1 GET `/api/homepage/summary`

Use for dashboard pie/chart summary.

Query params: none

Success response:
```json
{
  "success": true,
  "data": {
    "plantStatus": {
      "normal": 3,
      "faulty": 1,
      "disconnected": 2
    },
    "activeAlarms": {
      "critical": 0,
      "major": 0,
      "minor": 0,
      "warning": 0,
      "supported": false
    },
    "notificationAlarms": []
  }
}
```

Notes:
- `activeAlarms` and `notificationAlarms` are currently placeholder values.
- `supported: false` means alarm sync is not fully enabled yet.

---

### 2.2 GET `/api/homepage/plants`

Use for homepage plant table.

Query params:
- `q` (optional): search by `name` or `plantCode`
- `page` (optional, default `1`)
- `pageSize` (optional, default `20`, min `10`, max `100`)

Success response:
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
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

Notes:
- `gridConnectionDate`, `optimizerQuantity`, `totalYieldKWh`, `performanceRatio` are currently `null` placeholders.

---

## 3) Monitoring APIs (`/api/monitoring`)

### 3.1 GET `/api/monitoring/sites`

Use to list all sites for monitoring screens.

Success response:
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

---

### 3.2 GET `/api/monitoring/sites/:siteId/overview`

Use for site overview page (site info + inverter list + recent daily energy).

Path params:
- `siteId` (required, number)

Success response:
```json
{
  "data": {
    "site": {
      "id": 1,
      "plantCode": "PLANT-001",
      "name": "Solar Farm A",
      "capacityKWp": 500
    },
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
    "energySeries": [
      {
        "date": "2026-02-01T00:00:00.000Z",
        "yieldKWh": 613.5
      }
    ],
    "lastUpdatedAt": "2026-02-03T01:05:00.000Z"
  }
}
```

Errors:
- `400` invalid `siteId`
- `404` site not found

---

### 3.3 GET `/api/monitoring/inverters/:inverterId`

Use for inverter detail header/realtime summary.

Path params:
- `inverterId` (required, number)

Success response:
```json
{
  "data": {
    "id": 10,
    "name": "INV-1",
    "model": "SUN2000",
    "serialNumber": "SN-ABC",
    "stationCode": "ST-001",
    "site": {
      "id": 1,
      "name": "Solar Farm A",
      "plantCode": "PLANT-001"
    },
    "realtime": {
      "activePower": 8.2,
      "dayEnergy": 34.5,
      "status": "Normal",
      "lastSyncAt": "2026-02-03T01:00:00.000Z"
    }
  }
}
```

Errors:
- `400` invalid `inverterId`
- `404` inverter not found

---

### 3.4 GET `/api/monitoring/inverters/:inverterId/strings/latest`

Use for latest string table.

Path params:
- `inverterId` (required, number)

Success response:
```json
{
  "data": {
    "ts": "2026-02-03T01:00:00.000Z",
    "strings": [
      { "stringNo": 1, "voltage": 450.2, "current": 9.5, "status": "Normal" }
    ]
  }
}
```

If no snapshot exists:
```json
{
  "data": {
    "ts": null,
    "strings": []
  }
}
```

---

### 3.5 GET `/api/monitoring/inverters/:inverterId/history`

Use for line charts.

Path params:
- `inverterId` (required, number)

Query params:
- `metric` (optional, default `activePower`)
  - allowed: `activePower`, `dayEnergy`, `temperature`, `powerFactor`
- `range` (optional, default `day`)
  - allowed: `day`, `week`, `month`

Success response:
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

Errors:
- `400` invalid `inverterId`
- `400` invalid `range`
- `400` invalid `metric`

---

## 4) Stock APIs (`/api/stock`)

### 4.1 Recommended frontend mapping by page

- All Stock page:
  - `GET /api/stock/meta`
  - `GET /api/stock/summary`
- Add Product modal:
  - `GET /api/stock/meta` (dropdown source)
  - `POST /api/stock/products`
- Stock In page:
  - `GET /api/stock/meta` or `GET /api/stock/products`
  - `GET /api/stock/in`
  - `POST /api/stock/in`
- Stock Out page:
  - `GET /api/stock/meta` or `GET /api/stock/products?availableOnly=true`
  - `GET /api/stock/out`
  - `POST /api/stock/out`

---

### 4.2 GET `/api/stock/meta`

Returns category/unit/product dropdown data.

Query params:
- `includeInactive` (optional: `true|false`, default `false`)

Success response:
```json
{
  "success": true,
  "data": {
    "categories": [{ "id": 1, "name": "Spare Parts" }],
    "units": [{ "id": 1, "name": "pcs" }],
    "products": [
      {
        "id": 1,
        "sku": "SKU-001",
        "name": "MC4 Connector",
        "categoryId": 1,
        "category": "Spare Parts",
        "unitId": 1,
        "unit": "pcs",
        "inQty": 20,
        "outQty": 5,
        "onHand": 15,
        "isActive": true
      }
    ]
  }
}
```

---

### 4.3 Category master

#### GET `/api/stock/categories`
#### POST `/api/stock/categories`
Body:
```json
{ "name": "Spare Parts" }
```

#### PATCH `/api/stock/categories/:id`
Body:
```json
{ "name": "Updated Name" }
```

#### DELETE `/api/stock/categories/:id`

Notes:
- DELETE fails with `400` if category is used by products.

---

### 4.4 Unit master

#### GET `/api/stock/units`
#### POST `/api/stock/units`
Body:
```json
{ "name": "pcs" }
```

#### PATCH `/api/stock/units/:id`
Body:
```json
{ "name": "box" }
```

#### DELETE `/api/stock/units/:id`

Notes:
- DELETE fails with `400` if unit is used by products.

---

### 4.5 Products

#### GET `/api/stock/products`

Query params (all optional):
- `q`, `sku`, `name`
- `productId`, `categoryId`, `unitId`
- `includeInactive` (`true|false`, default `false`)
- `availableOnly` (`true|false`, default `false`)

Response item:
```json
{
  "productId": 1,
  "sku": "SKU-001",
  "categoryId": 1,
  "category": "Spare Parts",
  "name": "MC4 Connector",
  "unitId": 1,
  "unit": "pcs",
  "inQty": 20,
  "outQty": 5,
  "onHand": 15,
  "isActive": true
}
```

#### POST `/api/stock/products`

Required body:
```json
{
  "sku": "SKU-001",
  "name": "MC4 Connector",
  "categoryId": 1,
  "unitId": 1
}
```

Optional body:
- `isActive` (`true|false`, default `true`)

#### PATCH `/api/stock/products/:id`

At least one field required:
- `sku`, `name`, `categoryId`, `unitId`, `isActive`

---

### 4.6 GET `/api/stock/summary`

Use for All Stock table.

Query params:
- Pagination:
  - `page` (default `1`)
  - `pageSize` (default `20`, max `100`)
- Product filters:
  - `q`, `sku`, `name`, `productId`, `categoryId`, `unitId`
  - `includeInactive` (`true|false`, default `false`)
- Numeric filters:
  - `inQtyMin`, `inQtyMax`
  - `outQtyMin`, `outQtyMax`
  - `onHandMin`, `onHandMax`

Success response:
```json
{
  "success": true,
  "data": {
    "list": [
      {
        "productId": 1,
        "sku": "SKU-001",
        "categoryId": 1,
        "category": "Spare Parts",
        "name": "MC4 Connector",
        "unitId": 1,
        "unit": "pcs",
        "inQty": 20,
        "outQty": 5,
        "onHand": 15,
        "isActive": true
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

---

### 4.7 Stock In

#### GET `/api/stock/in`

Use for Stock In list page.

Query params:
- Pagination: `page`, `pageSize`
- Product filters: `q`, `sku`, `name`, `productId`, `categoryId`, `unitId`, `includeInactive`
- Transaction filters:
  - `dateFrom`, `dateTo`
  - `quantityMin`, `quantityMax`
  - `project`, `receiver`, `vendor`, `insuranceCompany`, `insuranceNo`, `note`

Response list item:
```json
{
  "id": 10,
  "type": "IN",
  "txDate": "2026-02-03T01:00:00.000Z",
  "productId": 1,
  "sku": "SKU-001",
  "categoryId": 1,
  "category": "Spare Parts",
  "productName": "MC4 Connector",
  "unitId": 1,
  "unit": "pcs",
  "quantity": 20,
  "inQty": 20,
  "outQty": 0,
  "onHand": 15,
  "project": "Project A",
  "receiver": "Somchai",
  "vendor": "Supplier X",
  "insuranceCompany": "Insure Co",
  "insuranceNo": "INS-001",
  "note": "Initial stock in",
  "createdAt": "2026-02-03T01:00:00.000Z",
  "updatedAt": "2026-02-03T01:00:00.000Z"
}
```

#### POST `/api/stock/in`

Required body:
```json
{
  "productId": 1,
  "quantity": 20
}
```

Optional body:
- `txDate`, `project`, `receiver`, `vendor`, `insuranceCompany`, `insuranceNo`, `note`, `jobId`

---

### 4.8 Stock Out

#### GET `/api/stock/out`

Same query model and response shape as Stock In, but:
- `type` is `OUT`
- `inQty` is `0`
- `outQty` is transaction quantity

#### POST `/api/stock/out`

Required body:
```json
{
  "productId": 1,
  "quantity": 5
}
```

Optional body:
- `txDate`, `project`, `receiver`, `vendor`, `insuranceCompany`, `insuranceNo`, `note`, `jobId`

Important validation:
- Returns `400` when `quantity > onHand` with message:
  - `insufficient stock: onHand=<number>`

---

## 5) Common Error Cases (Frontend Handling)

- `400` validation error:
  - invalid IDs
  - invalid date/range
  - missing required fields
- `404` not found:
  - product/site/inverter not found
- `409` duplicate value:
  - duplicate unique fields (for example category name, unit name, or product SKU)
- `500` internal server error

Recommended frontend handling:
- If HTTP status >= 400, read both:
  - `message` (stock/homepage)
  - `error` (monitoring)

---

# 6) Cleaning / Inspection / Service (Job Flows)

ทั้ง 3 โมดูลมีแนวคิดเหมือนกัน:

1) FE เรียก `GET .../projects` เพื่อให้ผู้ใช้เลือก Project Name
2) เมื่อเลือกแล้ว FE เอาข้อมูลที่ได้มา **เติมช่องสีเทา (auto-fill)** ทันที เช่น Location, System Size (kWp)
3) Step1: สร้าง/อัปเดต Draft job
4) Step2: ร่างอีเมล + แนบไฟล์ + กด send ส่งจริงผ่าน Gmail SMTP
5) Step3: อัปโหลดไฟล์หลักฐาน/รายงาน (แต่ละโมดูลไม่เหมือนกัน)
6) Step4/5: สร้าง report (บางโมดูล) + ส่งอีเมลแนบ report

> NOTE: Endpoint พวกนี้ “ใช้ DB เป็นหลัก” (Site/Job/CleaningJob/InspectionJob/ServiceJob) ไม่ได้ยิง Huawei ตอนเลือก project เพื่อลด rate limit

## 6.1 Cleaning APIs (`/api/cleaning`)

### 6.1.1 GET `/api/cleaning/projects`
ใช้ทำ dropdown + auto-fill

### 6.1.2 POST `/api/cleaning/step1`
**Content-Type:** `application/json`

**Body (create):**
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

**Response:** `{ success: true, data: { jobId, jobNo } }`

### 6.1.3 POST `/api/cleaning/step2/draft`
**Content-Type:** `multipart/form-data`

Fields:
- `jobId` (text)
- `to` (text)
- `subject` (text)
- `body` (text / html)
- `files` (file) ✅ **ชื่อ field ต้องเป็น `files`**

### 6.1.4 POST `/api/cleaning/step2/send`
**Content-Type:** `application/json`
```json
{ "jobId": 1 }
```

### 6.1.5 POST `/api/cleaning/step3/evidence`
**Content-Type:** `multipart/form-data`

Fields:
- `jobId` (text)
- `labelType` (text) เช่น `BEFORE` / `AFTER` / `CERTIFICATE` / `LAYOUT`
- `files` (file) ✅ field = `files`

### 6.1.6 POST `/api/cleaning/step3/checklist`
**Content-Type:** `application/json`
```json
{
  "jobId": 1,
  "checklistJson": "[{\"item\":\"...\",\"ok\":true}]",
  "step3SummaryNote": "สรุปผล..."
}
```

### 6.1.7 POST `/api/cleaning/step4/generate`
**Content-Type:** `application/json`
```json
{ "jobId": 1 }
```

### 6.1.8 GET `/api/cleaning/step4/download/:jobId`
ดาวน์โหลด report ที่สร้างแล้ว

### 6.1.9 POST `/api/cleaning/step5/send`
**Content-Type:** `application/json`
```json
{ "jobId": 1, "to": "...", "subject": "...", "body": "..." }
```

---

## 6.2 Inspection APIs (`/api/inspection`)

### 6.2.1 GET `/api/inspection/projects`
ใช้ทำ dropdown + auto-fill

### 6.2.2 POST `/api/inspection/step1`
**Content-Type:** `application/json`
Body เหมือน cleaning (แต่เป็น inspection)

### 6.2.3 POST `/api/inspection/step2/draft`
**Content-Type:** `multipart/form-data`

Fields:
- `jobId` (text)
- `to` (text)
- `subject` (text)
- `body` (text / html)
- `attachments` (file) ✅ field = `attachments`

### 6.2.4 POST `/api/inspection/step2/send`
**Content-Type:** `application/json`
```json
{ "jobId": 1 }
```

### 6.2.5 POST `/api/inspection/step3/draft`
**Content-Type:** `multipart/form-data`

Fields:
- `jobId` (text)
- `to` (text)
- `subject` (text)
- `body` (text / html)
- `report` (file) ✅ field = `report`

### 6.2.6 POST `/api/inspection/step3/send`
**Content-Type:** `application/json`
```json
{ "jobId": 1 }
```

---

## 6.3 Service APIs (`/api/service`)

### 6.3.1 GET `/api/service/projects`
ใช้ทำ dropdown + auto-fill

### 6.3.2 POST `/api/service/step1`
**Content-Type:** `application/json`
Body เหมือน cleaning (มี field เพิ่มบางตัว เช่น serviceType/remark แล้วแต่ UI)

### 6.3.3 POST `/api/service/step2/draft`
**Content-Type:** `multipart/form-data`

Fields:
- `jobId` (text)
- `to` (text)
- `subject` (text)
- `body` (text / html)
- `files` (file) ✅ field = `files`

### 6.3.4 POST `/api/service/step2/send`
**Content-Type:** `application/json`
```json
{ "jobId": 1 }
```

### 6.3.5 POST `/api/service/step3/draft`
**Content-Type:** `multipart/form-data`

Fields:
- `jobId` (text)
- `serviceReport` (file) ✅ field = `serviceReport`
- `evidence` (file) ✅ field = `evidence`

### 6.3.6 POST `/api/service/step4/generate`
**Content-Type:** `application/json`
```json
{ "jobId": 1 }
```

### 6.3.7 GET `/api/service/step4/download/:jobId`
ดาวน์โหลด report ที่สร้างแล้ว

### 6.3.8 POST `/api/service/step5/send`
**Content-Type:** `application/json`
```json
{ "jobId": 1, "to": "...", "subject": "...", "body": "..." }
```

---

## 6.4 Postman tips (เรื่องไฟล์แนบ)

ใน Postman:

- เลือก **Body → form-data**
- Key ที่เป็นไฟล์ ให้เลือกชนิดเป็น **File** แล้วกดเลือกไฟล์จากเครื่อง
- Key ต้องตรงกับ route (เช่น `files` / `attachments` / `report` / `serviceReport` / `evidence`)

ถ้าเจอ `MulterError: Unexpected field` = ส่งชื่อ field ไม่ตรงกับที่ backend รอรับ

---

# 7) Client Data APIs (`/api/client-data`)

Module นี้ใช้สำหรับหน้า:

- PowerVault (Thailand)
- PowerVault Service
- Warranty Detail (Supplier / Customer)
- Layout PV / PV String
- Forecast (PVsyst / Warranty Energy Output)
- Other tab (Description / Remark table)

---

## 7.1 Project List (PowerVault Thailand)

### 7.1.1 GET `/api/client-data/thailand/projects`

Use for main Client Data table.

Query params (optional):
- `projectNo`
- `projectName`
- `capacityKwp`
- `status`
- `page` (default `1`)
- `pageSize` (default `10`)

Success response:
```json
{
  "success": true,
  "data": {
    "list": [
      {
        "id": 232,
        "projectNo": "PV-001",
        "projectName": "Test Solar Site",
        "capacityKwp": 500,
        "status": "ACTIVE",
        "startWarranty": "2024-01-01T00:00:00.000Z",
        "endWarranty": "2029-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 10,
      "total": 1,
      "totalPages": 1
    }
  }
}
```

---

### 7.1.2 POST `/api/client-data/thailand/projects`

Required body:
```json
{
  "projectNo": "PV-001",
  "projectName": "Test Solar Site",
  "capacityKwp": 500,
  "status": "ACTIVE"
}
```

Optional body:
- `startWarranty`
- `endWarranty`
- `company`
- `address`
- `epcPPA`
- `panelBrand`
- `panelPowerW`
- `inverterBrand`

Validation:
- `capacityKwp` is required (number)
- `projectNo` must be unique

---

## 7.2 Project Detail

### 7.2.1 GET `/api/client-data/projects/:siteId`

Use for all tabs in Project Detail page:
- Information
- Warranty Detail
- Layout
- Forecast
- Other

Errors:
- `400` invalid siteId
- `404` project not found

---

# 7.3 Warranty Detail

## 7.3.1 POST `/api/client-data/projects/:siteId/warranty/supplier`

Required body:
```json
{
  "category": "Solar Panels",
  "itemName": "LR5-72HPH",
  "supplierName": "LONGi",
  "quantity": 1000,
  "warrantyYears": 10
}
```

Optional:
- `productName`
- `startWarranty`
- `endWarranty`

Validation:
- `category` and `itemName` are required

---

## 7.3.2 POST `/api/client-data/projects/:siteId/warranty/customer`

Required body:
```json
{
  "category": "Inverter & Monitoring System",
  "itemName": "Product Warranty",
  "warrantyYears": 5
}
```

Validation:
- `category` and `itemName` are required

---

# 7.4 Layout (PV Layout / PV String Layout)

### 7.4.1 POST `/api/client-data/projects/:siteId/layouts/PV_LAYOUT`
### 7.4.2 POST `/api/client-data/projects/:siteId/layouts/PV_STRING_LAYOUT`

Content-Type: `multipart/form-data`

Field:
- `file` (File) required

Files are stored in `uploads/` and served via `/uploads/...`

---

# 7.5 Forecast

## 7.5.1 PUT `/api/client-data/projects/:siteId/forecast/pvsyst`

Body:
```json
{
  "rows": [
    {
      "month": 1,
      "globalKwhM2": 150,
      "eGridKwh": 50000,
      "prRatio": 0.8
    }
  ]
}
```

Notes:
- `month` must be number (1–12)
- `rows` must be an array

---

## 7.5.2 PUT `/api/client-data/projects/:siteId/forecast/warranty-energy`

Body:
```json
{
  "rows": [
    {
      "year": 1,
      "degradationPercent": 2,
      "annualProductionKwh": 700000,
      "warrantyEnergyKwh": 680000
    }
  ]
}
```

Notes:
- `year` must be number
- `rows` must be an array

---

# 7.6 Other Tab

### 7.6.1 POST `/api/client-data/projects/:siteId/other`

Body:
```json
{
  "status": "Open",
  "description": "Roof access issue",
  "remark": "Need inspection"
}
```

---

# 7.7 PowerVault Service List

### 7.7.1 GET `/api/client-data/service/entries`

Query params:
- `job`
  - allowed: `SERVICE`, `CLEANING`, `INSPECTION`, `OM`

---

### 7.7.2 POST `/api/client-data/service/entries`

Required body:
```json
{
  "siteId": 232,
  "job": "OM",
  "description": "Quarterly maintenance"
}
```

Validation:
- `job` must be one of:
  - `SERVICE`
  - `CLEANING`
  - `INSPECTION`
  - `OM`

---

# 7.8 Common Error Cases (Client Data)

- `400` validation error:
  - missing required fields
  - invalid enum (job)
  - rows not array
  - month not number
- `404` project not found
- `409` duplicate projectNo
- `500` internal server error
