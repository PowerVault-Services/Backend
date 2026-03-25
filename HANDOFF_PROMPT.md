# Solar Monitoring Backend — Full Context Handoff

คุณกำลังทำงานกับ Solar Monitoring Backend (Node.js/Express/Prisma/PostgreSQL) ที่ดึงข้อมูลจาก Huawei FusionSolar Northbound API เพื่อ monitor โรงไฟฟ้าโซลาร์ 253 sites แล้วเสิร์ฟให้หน้า frontend

## สถาปัตยกรรมปัจจุบัน

- **Single-process monolith** — Express API + Cron jobs + Huawei clients ทั้งหมดรันใน process เดียว (`src/app.ts`)
- **Database**: PostgreSQL via Prisma ORM
- **Huawei API**: FusionSolar `https://intl.fusionsolar.huawei.com/thirdData/*`
- **Deploy**: CE Cloud (KMITL) — รัน 24/7 บน cloud (timezone UTC)
- **Branch**: `dev` (main branch คือ `main`)

## ไฟล์สำคัญ

| ไฟล์ | หน้าที่ |
|------|--------|
| `src/services/huaweiService.ts` | Huawei API client class — login, throttle chain (6.5s min interval), circuit breaker, rate limit handling |
| `src/services/huaweiPool.ts` | จัดการ 4 accounts, PURPOSE_ORDER routing, batchIndex rotation, client selection |
| `src/services/syncService.ts` | Cron sync: plant inventory, site realtime KPI, device sync (inverters) |
| `src/services/alarmSyncService.ts` | Alarm sync — incremental + full sweep |
| `src/services/monitoringHomeService.ts` | หน้า monitoring: Energy Management graph + Home Realtime (energy flow, summary cards) |
| `src/services/huaweiKpiCache.ts` | In-memory cache สำหรับ KPI endpoints (stale-while-revalidate) |
| `src/services/siteAnalyticsService.ts` | PR (Performance Ratio) analytics |
| `src/services/syncStateService.ts` | Persist sync job state ลง DB — resume after restart ด้วย `getStalestStationCodes` |
| `src/jobs/cron.ts` | Cron schedules — site realtime (*/5), alarm (1-59/5), device (2-59/5) + watchdog |
| `src/routes/monitoringRoutes.ts` | REST endpoints: `/pr`, `/sites/:id/energy-management`, `/sites/:id/home-realtime`, `/sites/:id/energy-flow` |
| `src/config/env.ts` | Zod validation สำหรับ env vars ทั้งหมด |
| `prisma/schema.prisma` | DB schema |

## Huawei API Endpoints ที่ใช้

| Endpoint | ใช้ทำอะไร |
|----------|----------|
| `/thirdData/login` | Auth (5 login / 10 min per account) |
| `/thirdData/stations` | Plant list (plantCode, capacity, location) |
| `/thirdData/getStationRealKpi` | Site realtime: power, energy, income, health |
| `/thirdData/getDevList` | Device inventory per station |
| `/thirdData/getDevRealKpi` | Device realtime: voltage, current, power per string |
| `/thirdData/getAlarmList` | Alarms: severity, timestamp, device info |
| `/thirdData/getKpiStationHour` | Hourly KPI (กราฟรายชั่วโมง) |
| `/thirdData/getKpiStationDay` | Daily KPI (กราฟรายวัน) |
| `/thirdData/getKpiStationMonth` | Monthly KPI (กราฟรายเดือน) |
| `/thirdData/getKpiStationYear` | Yearly KPI (กราฟรายปี) |

## Huawei Rate Limiting

- **failCode 407** = per-account rate limit → cooldown 300s (5 min) + minInterval x 1.25
- **failCode 403/429** = org-wide rate limit → cooldown 60s
- **Throttle chain**: per-account, min 6.5s between requests (ปรับขึ้นถึง 15-20s เมื่อโดน 407, decay กลับหลัง 10 นาทีไม่โดน)
- **Circuit breaker**: 5 failures → open 120s
- **Login guard**: max 5 login / 10 min per account

## 4 Huawei Accounts (ปัจจุบัน — 4 credentials แยกกันจริง)

```
MAIN (pvscada)      — ตัวหลัก
BACKUP (APIscada1)  — สำรอง
ALARM (APIscada2)   — สำหรับ alarm
ONDEMAND (APIscada3) — reserved สำหรับ on-demand requests จากหน้า monitoring เท่านั้น
```

Credentials อยู่ใน env vars: `HUAWEI_USER/PASSWORD`, `HUAWEI_BACKUP_*/ALARM_*/ONDEMAND_*`

Account instances สร้างใน `huaweiService.ts:553-556` ด้วย `getOrCreateHuaweiService()` ที่ dedup ถ้า credentials ซ้ำ

PURPOSE_ORDER ใน `huaweiPool.ts:13-19` (สถานะปัจจุบัน):
```ts
inventory:    ['backup', 'main', 'alarm', 'ondemand'],
siteRealtime: ['main', 'backup', 'alarm', 'ondemand'],
device:       ['main', 'backup', 'alarm'],         // ondemand ถูกเอาออกแล้ว
alarm:        ['alarm', 'backup', 'main'],          // ondemand ถูกเอาออกแล้ว
ondemand:     ['ondemand', 'alarm', 'backup', 'main'],
```

## Cron Jobs and Startup Warmup

```
Cron schedules (ทุก 5 นาที stagger กัน):
  - Site Realtime: */5 * * * *
  - Alarm:         1-59/5 * * * *
  - Device:        2-59/5 * * * *

Startup warmup (src/jobs/cron.ts:169-171):
  - Site Realtime: +5s หลัง start
  - Alarm:         +20s หลัง start
  - Device:        +40s หลัง start
```

ปัญหา startup warmup: ทุก task ยิงพร้อมกันในช่วง 40 วินาทีแรก ทำให้ accounts โดน 407 พุ่งเพราะ login + API calls ชนกันข้าม tasks ถ้ามี frontend team รัน code ชุดเดียวกันด้วย credentials เดียวกัน จะโดน 407 เร็ว 2 เท่า

## DB Schema ที่เกี่ยวข้อง (Prisma)

```
Site: id, plantCode, currentPowerKW, dayEnergyKWh, monthEnergyKWh, totalEnergyKWh,
      dayIncome, totalIncome, siteRealtimeRaw (Json), lastPlantSyncAt, deviceMetaSyncedAt

SiteDailyEnergy: siteId, date, energyKWh, raw (Json)

SiteMonthlyActual: siteId, plantCode, year, month, key ("YYYY-MM"),
                   collectTime, irradiation, production, pr, gridImport, gridExport,
                   consumption, revenue

Inverter: id, serialNumber, siteId, huaweiDevId, huaweiDevTypeId, stationCode, activePower

InverterKpiSnapshot: inverterId, ts, activePower, dayEnergy, totalEnergy, runState, raw (Json)
  -> InverterStringSnapshot: stringNo, voltage, current

SiteForecastMonthly: siteId, month, globalKwhM2, eGridKwh, prRatio
SiteForecastYearly: siteId, year, annualProductionKwh

HuaweiSyncStation: stationCode, lastSeenAt, ... (ใช้โดย syncStateService สำหรับ staleness tracking)
```

## สิ่งที่ Optimize ไปแล้ว (ทั้งหมด)

1. minInterval decay — throttle ค่อยๆ ลดกลับหลัง 10 นาทีไม่โดน 407
2. Retry limit ลดจาก 8 เป็น 3
3. Staleness-based sync — getStalestStationCodes ดึง site ที่เก่าสุดก่อน, persist ลง DB ทำให้ restart แล้ว resume ต่อได้ (ไม่เริ่ม site 1 ใหม่ทุกรอบ)
4. Incremental alarm sync — ดึงเฉพาะ alarm ใหม่ (6h lookback) + full sweep ทุก 6h
5. Batched DB writes
6. Global request budget (huaweiBudget.ts)
7. KPI caching สำหรับ graph (in-memory, stale-while-revalidate)
8. Round-robin on-demand client
9. Inflight request coalescing สำหรับ fetchAuxRealtime
10. PURPOSE_ORDER แก้แล้ว — เอา ondemand ออกจาก device และ alarm purpose เพื่อ reserve ไว้สำหรับ on-demand เท่านั้น
11. Device sync batchIndex แก้แล้ว — syncPlantDevicesWithFailover รับ batchIndex parameter และ worker loop ส่ง site index เข้าไป ทำให้กระจาย 3 accounts (main/backup/alarm) แบบ rotate

### รายละเอียด Device Sync batchIndex (แก้ไปแล้ว สำหรับอ้างอิง)

syncPlantDevicesWithFailover (syncService.ts:853-858):
```ts
async function syncPlantDevicesWithFailover(
  site: SiteLite,
  runStateCount: Map<number, number>,
  opts?: SyncPlantDevicesOptions,
  purpose: 'device' | 'ondemand' = 'device',
  batchIndex?: number                          // เพิ่มแล้ว
): Promise<SyncPlantDevicesResult> {
  const clients = getStationClientCandidates(
    site.plantCode,
    purpose === 'ondemand' ? 'ondemand' : 'device',
    { batchIndex }                              // ส่ง batchIndex แล้ว
  );
```

Worker loop (syncService.ts:1048-1052):
```ts
const result = await syncPlantDevicesWithFailover(site, runStateCount, {
  includeInventory: true,
  includeDeviceDetail: true,
}, 'device', index);                            // ส่ง index เป็น batchIndex แล้ว
```

ผลลัพธ์: Site 0 ใช้ MAIN first, Site 1 ใช้ BACKUP first, Site 2 ใช้ ALARM first แล้ววน rotate

DEVICE_SYNC_CONCURRENCY (syncService.ts:143):
```ts
const DEVICE_SYNC_CONCURRENCY = Math.max(1,
  Number(process.env.HUAWEI_DEVICE_SYNC_CONCURRENCY ?? getPreferredClientOrderForPurpose('device').length)
);
// ปัจจุบัน device purpose มี 3 clients ดังนั้น concurrency = 3
```

---

# ปัญหาที่ยังไม่ได้แก้ (ทั้งหมดที่ต้องทำ)

## ~~ปัญหา 1: Timezone mismatch บน Cloud (กราฟไม่ work)~~ ✅ แก้แล้ว

แก้โดยเพิ่ม timezone-aware utilities (`tzParts`, `tzDate`) ใน `monitoringHomeService.ts` ที่ใช้ `Intl.DateTimeFormat` กับ `HUAWEI_SYNC_TIMEZONE` (default: Asia/Bangkok) แล้วแก้ทุก date function:
- `startOfDay/Month/Year`, `addHours/Days/Months/Years` — ใช้ Bangkok timezone
- `formatHourLabel/DayLabel/MonthLabel` — แสดง Bangkok hours/dates
- `bucketKey` — ใช้ Bangkok parts ทำให้ skeleton key match กับ Huawei data key
- `parseRequestedAnchor` — parse date strings เป็น Bangkok noon
- `collectTime` calculations — ใช้ `tzDate()` สร้าง noon Bangkok

## ปัญหา 2: กราฟยิง Huawei ตรง ไม่อ่าน DB ก่อน — แก้บางส่วนแล้ว

### 3 จุดที่ต้องแก้:

#### ~~2a. Energy Management Graph~~ ✅ แก้บางส่วนแล้ว
- **Year/Lifetime views**: อ่าน `SiteMonthlyActual` จาก DB ก่อน ถ้ามีข้อมูลไม่ยิง Huawei เลย (lifetime aggregate by year)
- **Day/Month views**: ยังยิง Huawei ผ่าน `getCachedPlantKpi` (ไม่มี DB table สำหรับ hourly KPI, `SiteDailyEnergy` มีแค่ `energyKWh` ไม่ครบ fields)
- ถ้าต้องการ day/month DB-first ต้องสร้าง table ใหม่ (`SiteHourlyKpi`, `SiteDailyKpi`) เพื่อเก็บ full dataItemMap

#### 2b. Home Realtime — Aux Devices (ยังไม่ได้แก้)
ปัจจุบัน: getAuxDevices() ยิง Huawei getDevList ทุกครั้ง (มี 6h in-memory cache)
ควรเป็น: เก็บ aux device metadata ลง DB แล้วอ่านจาก DB ก่อน
หมายเหตุ: ต้องสร้าง DB table ใหม่สำหรับ aux devices (EMI, meter, battery ไม่อยู่ใน Inverter table)

#### ~~2c. PR Chart (/pr route)~~ ✅ แก้แล้ว
- **Month granularity**: อ่าน `SiteMonthlyActual` จาก DB ก่อน fallback Huawei ถ้า DB ว่าง
- **Year granularity**: aggregate `SiteMonthlyActual` by year จาก DB ก่อน fallback Huawei
- **Day granularity**: ยังยิง Huawei (ไม่มี daily KPI table)

#### ผลกระทบที่เหลือ (ลดลงมากแล้ว):
- Year/Lifetime Energy Management + PR month/year → อ่าน DB ใน <50ms ไม่ยิง Huawei
- Day/Month Energy Management + PR day → ยังใช้ Huawei ผ่าน in-memory cache (getCachedPlantKpi)
- Aux devices → ยังใช้ Huawei แต่มี 6h in-memory cache อยู่แล้ว

## ปัญหา 3: เพิ่ม Huawei Accounts จาก 4 เป็น 8

เป้าหมาย: ใช้ 7 accounts สำหรับ cron + 1 สำหรับ ondemand

ไฟล์ที่ต้องแก้ (3 ไฟล์):

1. `src/config/env.ts` — เพิ่ม 4 คู่ env vars:
   ```
   HUAWEI_EXTRA1_USER / HUAWEI_EXTRA1_PASSWORD
   HUAWEI_EXTRA2_USER / HUAWEI_EXTRA2_PASSWORD
   HUAWEI_EXTRA3_USER / HUAWEI_EXTRA3_PASSWORD
   HUAWEI_EXTRA4_USER / HUAWEI_EXTRA4_PASSWORD
   ```

2. `src/services/huaweiService.ts` — สร้าง 4 instances เพิ่ม:
   ```ts
   export const huaweiExtra1 = getOrCreateHuaweiService({ userName: extra1User, systemCode: extra1Pass, label: 'EXTRA1' });
   // ... x4
   ```

3. `src/services/huaweiPool.ts` — เพิ่ม client keys + อัพเดท:
   ```ts
   type HuaweiLogicalClientKey = 'main' | 'backup' | 'alarm' | 'ondemand' | 'extra1' | 'extra2' | 'extra3' | 'extra4';

   huaweiClients = { main, backup, alarm, ondemand, extra1, extra2, extra3, extra4 };

   PURPOSE_ORDER.device = ['main', 'backup', 'alarm', 'extra1', 'extra2', 'extra3', 'extra4'];
   PURPOSE_ORDER.alarm = ['alarm', 'backup', 'main', 'extra1', 'extra2', 'extra3', 'extra4'];
   ```

สิ่งที่ไม่ต้องแก้ (รองรับ N accounts อยู่แล้ว): rotate(), batchIndex, uniqueServices(), resolveDynamicDevicePlantsPerTick(), DEVICE_SYNC_CONCURRENCY (auto จาก client count)

Timing: 253 sites / 7 accounts x 6.5s = ประมาณ 4 นาที (จากเดิม 27 นาที ด้วย 1 account, 9 นาที ด้วย 3 accounts ปัจจุบัน)

ข้อควรระวัง:
- 407 (per-account) จะลดมาก
- 403/429 (org-wide) อาจไม่ลด เพราะ total requests/min สูงขึ้น ต้องมี HUAWEI_BUDGET_MAX_REQUESTS กำกับ

## ปัญหา 4: cron.ts hardcode 4 clients ใน resetStats

src/jobs/cron.ts:37-40 hardcode huaweiClients.main/backup/alarm/ondemand สำหรับ resetStats() ถ้าเพิ่มเป็น 8 ต้องอัพเดทให้ iterate ทุก client:
```ts
// ปัจจุบัน (hardcode):
huaweiClients.main.resetStats();
huaweiClients.backup.resetStats();
huaweiClients.alarm.resetStats();
huaweiClients.ondemand.resetStats();

// ควรเป็น:
Object.values(huaweiClients).forEach(c => c.resetStats());
```

เช่นเดียวกับ getCronStatus() (line 131-134) ที่ hardcode client status

## ปัญหา 5: Frontend team ใช้ credentials ชุดเดียวกัน

สาเหตุ: Frontend team pull backend code ไป dev โดยใช้ .env เดียวกัน ทำให้ accounts ถูกยิงซ้ำ 2 เครื่อง โดน 407 เร็ว 2 เท่า

วิธีแก้ (เลือกอย่างใดอย่างหนึ่ง):
1. เพิ่ม DISABLE_CRON=true flag ใน cron.ts — frontend team ใส่ flag นี้ปิด cron ฝั่งเขา ใช้ DB ที่ backend sync ให้
2. แยก credentials ให้ frontend ใช้คนละชุด

---

# Scalability Analysis

## สรุป: ระบบปัจจุบัน **ไม่รองรับ horizontal scale** (รัน 2+ instances ไม่ได้)

## In-Memory State ที่เป็น Blocker (8 ตัว)

| # | Cache/State | ไฟล์ | ปัญหาถ้ารัน 2 instances |
|---|-------------|------|------------------------|
| 1 | `stationAccessRegistry` | huaweiPool.ts:21 | routing ไม่ consistent — instance A เห็น failure, B ไม่เห็น |
| 2 | `stationCache` | syncService.ts:200 | station list ถูก cache คนละชุด → ยิง Huawei ซ้ำ (เล็กน้อย ทุก 6h) |
| 3 | `retryQueue` | syncService.ts:202 | retry ซ้ำ 2 เครื่อง → 407 เพิ่ม |
| 4 | `onDemandSyncInflight` | syncService.ts:203 | request coalescing ไม่ข้าม instance → user requests ยิงซ้ำ |
| 5 | `auxDeviceMetaCache` | monitoringHomeService.ts:75 | cold start ทุก instance → getDevList ×253 sites ×2 |
| 6 | `auxRealtimeCache` | monitoringHomeService.ts:76 | cold start ทุก instance → getDevRealKpi burst ×2 |
| 7 | KPI `cache` + `inflight` | huaweiKpiCache.ts:18-19 | stale-while-revalidate ไม่ข้าม instance → graph request ยิง Huawei ×2 |
| 8 | `throttleChain` (per client) | huaweiService.ts:69 | **ตัวร้ายสุด** — 2 instances ยิง 2x rate ต่อ account → 407 เพิ่มเท่าตัว |

## ปัญหาหลัก 2 ข้อถ้ารัน 2+ Instances

### A. Cron ซ้ำ 2 เครื่อง (load x2 ทันที)
- ไม่มี leader election หรือ distributed lock
- Device sync: 506 calls ×2 = 1,012 calls / tick vs capacity 370 calls (8 accounts)
- ทุก cron job (site realtime, device, alarm) ยิงซ้ำทั้งหมด

### B. throttleChain แยก instance (rate limit bypass โดยไม่ตั้งใจ)
- throttleChain เป็น per-process Promise chain
- Instance A: MAIN ยิง 1 req/6.5s, Instance B: MAIN ยิง 1 req/6.5s
- **Huawei เห็น MAIN ยิง 2 req/6.5s → โดน 407 ทันที**
- 8 accounts + 2 instances = เหมือนมีแค่ 4 accounts

## Budget Calculation

```
8 accounts × (1 req / 6.5s) = ~74 req/min = ~370 req / 5 min

1 instance:  ~550 calls/tick → ลากข้าม tick (OK มี guard)
2 instances: ~1,100 calls/tick → เกิน 3x capacity → 407 พุ่ง
```

## สรุปคำตอบตรงๆ

| คำถาม | คำตอบ |
|-------|-------|
| 8 accounts + 1 instance | **ใช้ได้ดี** — 407 ลดมาก, device sync ~4 นาที |
| 8 accounts + 2 instances | **ไม่ลด 407 อาจแย่ลง** — load x2 เหมือนมีแค่ 4 accounts |
| ปัญหาจริงที่ต้องแก้ก่อน scale | กราฟอ่าน DB ก่อน (ปัญหา 2) ลด load สำคัญกว่าเพิ่ม instance |

## สำหรับ 253 sites — ไม่ต้อง horizontal scale

Single process + แก้ปัญหาข้างบน เพียงพอแล้ว:
- กราฟอ่าน DB → ONDEMAND แทบไม่ต้องยิง Huawei
- 8 accounts → device sync 4 นาที ไม่มี 407
- DISABLE_CRON สำหรับ frontend → ลด load ซ้ำ

## ถ้าอนาคต sites เพิ่ม 500+ ค่อยทำ (ยังไม่ต้อง):
1. แยก worker process ออกจาก API server (API: read DB only, Worker: cron + Huawei)
2. ใช้ Redis แทน in-memory cache (KPI cache, aux cache, inflight coalescing)
3. เพิ่ม distributed lock สำหรับ cron (Redis lock / pg advisory lock)
4. ย้าย throttleChain เป็น Redis-based rate limiter (ข้าม instance ได้)

---

# ลำดับแก้ไขที่แนะนำ (priority order)

| # | ปัญหา | ความยาก | ผลกระทบ | สถานะ |
|---|--------|---------|---------|-------|
| 1 | Device sync batchIndex | ง่าย | สูง | แก้แล้ว |
| 2 | PURPOSE_ORDER เอา ondemand ออก | ง่าย | สูง | แก้แล้ว |
| 3 | Timezone mismatch (ปัญหา 1) | กลาง | สูง — กราฟ null บน cloud | ✅ แก้แล้ว — tzParts/tzDate utilities |
| 4 | กราฟอ่าน DB ก่อน (ปัญหา 2) | กลาง-ยาก | สูงมาก — UX + ลด API load | ✅ แก้บางส่วน — year/lifetime/PR month+year อ่าน DB, day/month ยัง Huawei |
| 5 | Frontend DISABLE_CRON (ปัญหา 5) | ง่ายมาก | กลาง — ลด 407 ทันที | ยังไม่ได้แก้ |
| 6 | เพิ่ม 8 accounts (ปัญหา 3) | กลาง | สูง — ถ้ามี credentials | รอ credentials |
| 7 | cron.ts hardcode (ปัญหา 4) | ง่าย | ต่ำ — ทำพร้อมข้อ 6 | ยังไม่ได้แก้ |

คำสั่ง compile test: `npx tsc --noEmit`

## ข้อควรระวังสำหรับ AI ที่รับต่อ

- อย่าเชื่อว่า .env มี 1 account — มี 4 accounts จริง (pvscada, APIscada1, APIscada2, APIscada3) ตรวจสอบได้ใน huaweiService.ts:516-556
- "8 accounts" หมายถึงต้องแก้โค้ดเพิ่ม client slots ด้วย ไม่ใช่แค่เพิ่ม env
- 407 เป็น per-account rate limit ไม่ใช่ org-wide — เพิ่ม account ช่วยลด 407 ได้จริง
- Device sync เป็น bottleneck เพราะยิง per-site (getDevList + getDevRealKpi) ต่างจาก site realtime ที่ยิง batch ได้
- getStationClientCandidates มี batchIndex parameter พร้อมใช้แล้ว — ระบบ rotation ทำงานด้วย rotate() function ใน huaweiPool.ts
- Alarm sync ใช้ batchIndex กระจาย account อยู่แล้ว (alarmSyncService.ts) — เป็นตัวอย่างที่ดี
