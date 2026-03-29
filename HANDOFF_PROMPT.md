# Solar Monitoring Backend — Full Context Handoff

คุณกำลังทำงานกับ Solar Monitoring Backend (Node.js/Express/Prisma/PostgreSQL) ที่ดึงข้อมูลจาก Huawei FusionSolar Northbound API เพื่อ monitor โรงไฟฟ้าโซลาร์ 253 sites แล้วเสิร์ฟให้หน้า frontend

## สถาปัตยกรรมปัจจุบัน

- **Split services** — แยก API server กับ Worker process ออกจากกัน deploy บนคนละ VM บน CE Cloud
  - `solar-api` (10.240.68.114): Express API + `DISABLE_CRON=1` + `USE_QUEUE=true`
  - `solar-worker` (10.240.68.60): Cron sync + Puppeteer PDF + Email via BullMQ
- **Database**: PostgreSQL via Prisma ORM (10.240.68.192)
- **File Storage**: MinIO (10.240.68.52:9000)
- **Queue**: BullMQ + Redis (10.240.68.192:6379) — API enqueue, Worker process
- **Huawei API**: FusionSolar `https://intl.fusionsolar.huawei.com/thirdData/*`
- **Deploy**: CE Cloud (KMITL) — CI/CD via GitHub Actions self-hosted runners (auto-deploy on push to `main`)
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

รายละเอียดเต็มอยู่ใน `docs/smartpvms_rate_limiting_compact_for_ai.md` และ `docs/smartpvms_nbi_25_4_compact_for_ai.md`

### Error codes & ระบบ backend ตอบสนอง

| failCode | ความหมาย | Backend response |
|----------|----------|------------------|
| **407** | per-account/per-user exceeded limit | cooldown 300s (5 min) + minInterval ×1.25 |
| **403/429** | system-wide API traffic too high | cooldown 60s → exponential backoff with jitter |

### Backend safeguards (ที่ implement แล้ว)

- **Throttle chain**: per-account, min 6.5s between requests (ปรับขึ้นถึง 15-20s เมื่อโดน 407, decay กลับหลัง 10 นาทีไม่โดน)
- **Circuit breaker**: 5 failures → open 120s
- **Login guard**: max 5 login / 10 min per account

### Authentication & Session (สำคัญมาก)

- `XSRF-TOKEN` อายุ **30 นาที** — reuse ได้ถ้ายังไม่หมดอายุ, ถ้า login ใหม่ token เก่า invalid ทันที
- **1 online session / account** — login ซ้ำจะ kill session เดิม
- Login API limit: **5 calls / 10 min / account** — ถ้า password ผิด 5 ครั้งใน 10 นาที lock account 30 นาที
- **ห้าม login ทุก request** — cache token + expiry, refresh เมื่อจำเป็นเท่านั้น
- ถ้ามีหลาย worker ใช้ account เดียวกัน ต้อง centralize token ownership (shared lock / leader refresh)

### New Policy — Rate Limit Formulas (default สำหรับ API account ใหม่)

`Roundup(x)` = ปัดขึ้นเป็นจำนวนเต็ม เช่น Roundup(20/100) = 1, Roundup(120/100) = 2

#### สำหรับ 253 plants, ~500 inverters, ~250 meters (ประมาณการ):

| API | สูตร | Window | Limit/account | หมายเหตุ |
|-----|------|--------|---------------|----------|
| **Plant List** | `Roundup(plants/100)*10+24` | /day | **54/day** | cache aggressively |
| **Device List** | `Roundup(plants/100)+24` | /day | **27/day** | ⚠️ daily limit ต่ำมาก — ต้อง cache |
| **Realtime Plant** | `Roundup(plants/100)` | /5 min | **3/5min** | poll ทุก 5 นาที |
| **Realtime Device** | `sum(Roundup(devices_by_type/100))` | /5 min | **~7/5min** | group by devTypeId |
| **Historical Device** | `sum(devices/60/10)` | /sec | **~0.13 req/s** | serialize heavily, 1 device/24h/request |
| **Active Alarms** | `max(Roundup(plants/100), sum(Roundup(devices_by_type/100)))` | /30 min | **~7/30min** | |
| **Plant Reports** (hour/day/month/year) | `Roundup(plants/100)+24` | /day each | **27/day** | |
| **Device Reports** (day/month/year) | `sum(Roundup(devices_by_type/100))+24` | /day each | **~32/day** | |
| **Control APIs** | 1 call/min/account | /min | **1/min** | submit once, poll sparingly |

#### OAuth Connect mode (ถ้าใช้):
- Basic APIs: **1000/day/owner**
- Control APIs: **100/day/owner**

### Old Policy (legacy, static — สำหรับ account เก่า)

| API | Limit |
|-----|-------|
| Plant list / Device list | 10/min |
| Real-time plant data | 30/min |
| Real-time device data | 10/min |
| Historical device data | 1/min |
| Active alarms | 10/min |
| Reports (hour/day/month/year) | 10/min each |

หมายเหตุ: FAQ ระบุว่า API account ใหม่ใช้ **new policy** เป็น default — อย่า assume old policy ถ้าไม่ได้พิสูจน์จาก behavior จริง

### กฎ Caching & Scheduling ที่ต้องปฏิบัติ

1. **Cache plant list + device list** — อย่าเรียกซ้ำทุก tick (daily quota ไม่พอ)
2. **Poll realtime ตาม 5-min cadence** — ไม่ต้องเร็วกว่านี้ (data refresh ทุก ~5 นาทีอยู่แล้ว)
3. **Report APIs เป็น delayed summaries** — ไม่ใช่ realtime, ใช้สำหรับ dashboard/export
4. **Historical Device API ถูกจำกัดมากที่สุด** — max 1 device/24h/request, serialize + queue + deduplicate
5. **Control APIs เป็น task workflow** — submit ครั้งเดียว แล้ว poll status ห่างๆ
6. **เพิ่ม jitter** ให้ทุก scheduled polling เพื่อลด synchronized bursts
7. **Report values อาจ lag** — day_income update ทุก 5 นาที แต่ total_income update ทุก 1 ชม. (current > total ได้ชั่วคราว)

## 5 Huawei Accounts (ปัจจุบัน — 5 credentials แยกกันจริง)

```
MAIN     (pvscada)    — ตัวหลัก
BACKUP   (APIscada1)  — สำรอง
ALARM    (APIscada2)  — สำหรับ alarm
ONDEMAND (APIscada3)  — reserved สำหรับ on-demand requests จากหน้า monitoring เท่านั้น
EXTRA1   (APIscada4)  — เพิ่มเพื่อ cron throughput (+33% device sync speed)
```

Credentials อยู่ใน env vars: `HUAWEI_USER/PASSWORD`, `HUAWEI_BACKUP_*/ALARM_*/ONDEMAND_*/EXTRA1_*`

Account instances สร้างใน `huaweiService.ts` ด้วย `getOrCreateHuaweiService()` ที่ dedup ถ้า credentials ซ้ำ

PURPOSE_ORDER ใน `huaweiPool.ts` (สถานะปัจจุบัน):
```ts
inventory:    ['backup', 'main', 'extra1', 'alarm', 'ondemand'],
siteRealtime: ['main', 'backup', 'extra1', 'alarm', 'ondemand'],
device:       ['main', 'backup', 'extra1', 'alarm'],  // 4 cron accounts → 8 sites/tick
alarm:        ['alarm', 'backup', 'main', 'extra1'],
ondemand:     ['ondemand', 'alarm', 'backup', 'main', 'extra1'],
```

## Cron Jobs and Startup Warmup

```
Cron schedules:
  - Site Realtime:  */5 * * * *          (ทุก 5 นาที)
  - Alarm:          1-59/5 * * * *       (ทุก 5 นาที offset :01)
  - Device:         2-59/5 * * * *       (ทุก 5 นาที offset :02)
  - Aux Realtime:   3-59/5 * * * *       (ทุก 5 นาที offset :03)
  - Hourly KPI:     10 * * * *           (ทุก 60 นาที — quota 27/day, 24 runs/day < limit)
  - Daily KPI:      15 * * * *           (ทุก 1 ชม. at :15)
  - Monthly KPI:    20 */4 * * *         (ทุก 4 ชม. at :20)

Startup warmup (stagger 30s ระหว่าง job):
  - Site Realtime: +5s
  - Alarm:         +30s
  - Device:        +60s
  - Hourly KPI:    +90s
  - Aux Realtime:  +120s
  - Daily KPI:     +180s
  - Monthly KPI:   +240s
```

✅ Startup warmup แก้แล้ว — stagger เพิ่มจาก 20s เป็น 30s ระหว่าง job เพื่อลด 407 burst ช่วง startup

## DB Schema ที่เกี่ยวข้อง (Prisma)

```
Site: id, plantCode, currentPowerKW, dayEnergyKWh, monthEnergyKWh, totalEnergyKWh,
      dayIncome, totalIncome, siteRealtimeRaw (Json), lastPlantSyncAt, deviceMetaSyncedAt

SiteDailyEnergy: siteId, date, energyKWh, raw (Json)

SiteHourlyKpi: siteId, plantCode, ts, collectTime, production, irradiation,
              gridImport, gridExport, consumption, consumedFromPv,
              batteryCharge, batteryDischarge

SiteDailyKpi: siteId, plantCode, date, collectTime, production, irradiation,
             gridImport, gridExport, consumption, revenue, selfProvide,
             batteryCharge, batteryDischarge, moduleTempC, downTimeClientHours, pr

SiteMonthlyActual: siteId, plantCode, year, month, key ("YYYY-MM"),
                   collectTime, irradiation, production, pr, gridImport, gridExport,
                   consumption, revenue, selfProvide

AuxDeviceSnapshot: siteId, plantCode, huaweiDevId, huaweiDevTypeId, dataItemMap (Json), fetchedAt

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
12. **getDevList inventory budget** — device sync ไม่เรียก getDevList ทุก site ทุก tick อีกแล้ว ใช้ `needsInventorySet` (cap `HUAWEI_INVENTORY_PER_TICK` default 2) + TTL 24h (`HUAWEI_DEVICE_META_TTL_MS`) เรียก getDevList เฉพาะ site ที่ deviceMetaSyncedAt เป็น null หรือหมดอายุ ที่เหลือใช้ cached inventory จาก Inverter table → getDevList ลดจาก 253/cycle เหลือ ~2/tick
13. **Aux realtime DB-first** — cron sync `syncAuxRealtimeTick` ทุก 5 นาที ดึง getDevRealKpi สำหรับ aux devices (meter, battery, EMI, weather) ทั้ง 253 sites → เก็บ `AuxDeviceSnapshot` table → `fetchAuxRealtimeInner` อ่าน DB ก่อน fallback Huawei เฉพาะ force refresh → ONDEMAND ไม่ต้องยิง API อีก
14. **Day view hourly KPI DB-first** — cron sync `syncHourlyKpiTick` ทุก 15 นาที ดึง getKpiStationHour → เก็บ `SiteHourlyKpi` table → `getEnergyManagementSeries` day view อ่าน DB ก่อน fallback Huawei → ONDEMAND daily quota ไม่หมด
15. **Monthly KPI cron sync** — cron sync `syncMonthlyKpiTick` ทุก 4 ชม. ดึง getKpiStationMonth → upsert `SiteMonthlyActual` table → year/lifetime view อ่าน DB ก่อน (DB-first มีอยู่แล้ว แต่ table ไม่ถูก populate จาก cron มาก่อน) → ONDEMAND ไม่ต้องยิง API สำหรับ year view อีก
16. **cron.ts dynamic clients** — `resetStats()` และ `getCronStatus()` ใช้ `Object.values(huaweiClients)` / `Object.entries(huaweiClients)` แทน hardcode 4 ตัว → เพิ่ม account ใหม่ไม่ต้องแก้ cron.ts
17. **Startup warmup stagger** — เพิ่ม interval จาก 20s เป็น 30s ระหว่าง job, กระจาย 7 jobs ใน 4 นาที แทน 6 jobs ใน 100 วินาที → ลด 407 burst ช่วง startup

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

## ~~ปัญหา 2: กราฟยิง Huawei ตรง ไม่อ่าน DB ก่อน~~ ✅ แก้หมดแล้ว

### สถานะจริงในโค้ด (ตรวจสอบแล้ว):

#### ~~2a. Energy Management Graph~~ ✅ แก้หมดแล้ว
- **Year/Lifetime views**: อ่าน `SiteMonthlyActual` จาก DB ก่อน ✅
- **Month view**: อ่าน `SiteDailyKpi` จาก DB ก่อน ✅ (cron `syncDailyKpiTick` ทุกชั่วโมง)
- **Day view**: อ่าน `SiteHourlyKpi` จาก DB ก่อน ✅ (cron `syncHourlyKpiTick` ทุก 15 นาที)

#### ~~2b. Home Realtime — Aux Devices~~ ✅ แก้หมดแล้ว
- **Aux Device List** (`getAuxDevices`): DB-first — อ่าน `AuxDevice` table ก่อน ✅
- **Aux Device Realtime** (`fetchAuxRealtimeInner`): **DB-first แล้ว** — อ่าน `AuxDeviceSnapshot` table ก่อน ✅ (cron `syncAuxRealtimeTick` ทุก 5 นาที), fallback Huawei เฉพาะ force refresh

#### ~~2c. PR Chart (/pr route)~~ ✅ แก้แล้ว
- Month/Year: อ่าน `SiteMonthlyActual` จาก DB ก่อน fallback Huawei
- Day: อ่าน `SiteHourlyKpi` จาก DB ก่อน (เดียวกับ day view)

#### สรุป ONDEMAND load ต่อการเปิดหน้า 1 plant:
```
Inverter cards:            0 API calls (DB - InverterKpiSnapshot)
Alarm banner:              0 API calls (DB - cron sync)
Energy Mgmt Year/Lifetime: 0 API calls (DB - SiteMonthlyActual, cron syncMonthlyKpiTick ทุก 4 ชม.)
Energy Mgmt Month:         0 API calls (DB - SiteDailyKpi)
Energy Mgmt Day:           0 API calls (DB - SiteHourlyKpi) ✅ แก้แล้ว
Aux Device List:           0 API calls (DB - AuxDevice table)
Aux Device Realtime:       0 API calls (DB - AuxDeviceSnapshot) ✅ แก้แล้ว
──────────────────────────────────────────────────
รวม:                       0 API calls → ดูกี่คนกี่ plant ก็ได้ ไม่ติด limit
```

## ~~ปัญหา 3: เพิ่ม Huawei Accounts~~ ✅ แก้แล้ว (EXTRA1)

เพิ่ม EXTRA1 (APIscada4) แล้ว รวม 5 accounts:
- MAIN (pvscada), BACKUP (APIscada1), ALARM (APIscada2), ONDEMAND (APIscada3), EXTRA1 (APIscada4)

ถ้าได้ account เพิ่มอีก (EXTRA2+) แก้แค่ 3 ไฟล์:
1. `src/config/env.ts` — เพิ่ม `HUAWEI_EXTRA2_USER / HUAWEI_EXTRA2_PASSWORD`
2. `src/services/huaweiService.ts` — สร้าง instance เพิ่ม
3. `src/services/huaweiPool.ts` — เพิ่มใน `huaweiClients` + `PURPOSE_ORDER`

สิ่งที่ไม่ต้องแก้: rotate(), batchIndex, uniqueServices(), resolveDynamicDevicePlantsPerTick(), DEVICE_SYNC_CONCURRENCY (auto จาก client count), cron.ts (ใช้ Object.values แล้ว)

## ~~ปัญหา 3.1: Huawei API Daily Quota (New Policy)~~ ✅ แก้แล้ว (getDevList cache)

ดู `docs/smartpvms_rate_limiting_compact_for_ai.md` สำหรับ rate limit formulas

### Quota จริงสำหรับ 253 plants (per account per day/5min):

| API | Limit/account | Window | 4 cron accounts | 6 cron accounts |
|-----|---------------|--------|-----------------|-----------------|
| Device List (getDevList) | 27/day | ต่อวัน | 108/day | 162/day |
| Real-time Plant Data | 3/5min | 5 นาที | 12/5min | 18/5min |
| Real-time Device Data | ~7/5min | 5 นาที | 28/5min | 42/5min |
| KPI Hour/Day/Month/Year | 27/day each | ต่อวัน | 108/day | 162/day |
| Active Alarms | ~7/30min | 30 นาที | 28/30min | 42/30min |

### วิธีที่แก้แล้ว:

**แยก device sync เป็น 2 ขั้น** (syncService.ts, `_syncMonitoringTickInner`):
1. **Inventory sync** (rare): เรียก getDevList เฉพาะ site ที่ `deviceMetaSyncedAt` เป็น null หรือหมดอายุ (> 24h TTL) — cap ต่อ tick ด้วย `HUAWEI_INVENTORY_PER_TICK` (default 2)
2. **Realtime sync** (frequent): เรียกแค่ getDevRealKpi ทุก 5 นาที (limit ต่อ 5 นาที ไม่ใช่ต่อวัน)

ผลลัพธ์: getDevList ลดจาก 253/cycle เหลือ ~2/tick (max ~576/day แต่ TTL 24h ทำให้จริงๆ เรียก ~253/day กระจายตลอดวัน) → 4 accounts ก็เพียงพอ

### Timing หลังแก้ (4 accounts, 3 cron):

```
getDevRealKpi: ~21 calls/5min budget (3 cron accounts x 7/5min)
Device sync ใช้แค่ getDevRealKpi (ไม่ต้อง getDevList ทุก tick)
→ sync ครบทุก site ได้ตามปกติ ไม่ติด daily quota
```

ข้อควรระวัง:
- 403/429 (org-wide) อาจไม่ลด เพราะ total requests/min สูงขึ้น ต้องมี HUAWEI_BUDGET_MAX_REQUESTS กำกับ
- First deploy: ทุก site มี deviceMetaSyncedAt = null → getDevList จะถูกเรียกทีละ 2/tick จนครบ 253 sites (~127 ticks = ~10.5 ชม.) หลังจากนั้น TTL refresh กระจายตลอดวัน

## ~~ปัญหา 4: cron.ts hardcode 4 clients ใน resetStats~~ ✅ แก้แล้ว

แก้โดยใช้ `Object.values(huaweiClients)` สำหรับ `resetStats()` และ `Object.entries(huaweiClients)` สำหรับ `getCronStatus()` → เพิ่ม account ใหม่ไม่ต้องแก้ cron.ts อีก

## ~~ปัญหา 5: Frontend team ใช้ credentials ชุดเดียวกัน~~ ✅ แก้แล้ว

**วิธีหลัก (แนะนำ)**: Frontend devs ต่อ VPN → ชี้ `VITE_API_URL=http://10.240.68.114:3000` → ไม่ต้องรัน backend เอง

**วิธีสำรอง (รัน backend local)**: ใส่ `DISABLE_CRON=true` ใน .env — cron.ts จะ skip Huawei sync ทั้งหมด:
```ts
if (process.env.DISABLE_CRON === '1' || process.env.DISABLE_CRON === 'true') {
  console.log('DISABLE_CRON=1 — skipping all Huawei sync jobs (frontend-only mode)');
  return;
}
```

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
| 8 accounts + 1 instance | **ใช้ได้** แต่ต้องแก้ getDevList cache ก่อน (daily quota ไม่พอ) |
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
| 1 | Device sync batchIndex | ง่าย | สูง | ✅ แก้แล้ว |
| 2 | PURPOSE_ORDER เอา ondemand ออก | ง่าย | สูง | ✅ แก้แล้ว |
| 3 | Timezone mismatch (ปัญหา 1) | กลาง | สูง | ✅ แก้แล้ว — tzParts/tzDate utilities |
| 4 | กราฟอ่าน DB ก่อน (ปัญหา 2) | กลาง-ยาก | สูงมาก | ✅ แก้เกือบหมด — เหลือ day view + aux realtime |
| 5 | Frontend DISABLE_CRON | ง่ายมาก | กลาง | ✅ แก้แล้ว — cron.ts line 156 |
| 6 | getDevList cache (ปัญหา 3.1) | กลาง | สูงมาก — daily quota ไม่พอ | ✅ แก้แล้ว — inventory budget per tick + TTL 24h |
| 7 | Aux realtime → cron sync + DB | กลาง | สูง — หลาย user พร้อมกัน = 407 | ✅ แก้แล้ว — AuxDeviceSnapshot + syncAuxRealtimeTick |
| 8 | Day view hourly KPI sync (ปัญหา 2 เหลือ) | กลาง | กลาง — ONDEMAND 27/day limit | ✅ แก้แล้ว — SiteHourlyKpi + syncHourlyKpiTick |
| 9 | เพิ่ม accounts (ปัญหา 3) | กลาง | กลาง — ช่วย cron throughput | ✅ แก้แล้ว — เพิ่ม EXTRA1 (APIscada4) รวม 5 accounts |
| 10 | cron.ts hardcode (ปัญหา 4) | ง่าย | ต่ำ — ทำพร้อมข้อ 9 | ✅ แก้แล้ว — Object.values/entries(huaweiClients) |

คำสั่ง compile test: `npx tsc --noEmit`

## ข้อควรระวังสำหรับ AI ที่รับต่อ

- อย่าเชื่อว่า .env มี 1 account — มี **5 accounts** จริง (pvscada, APIscada1-4) ตรวจสอบได้ใน huaweiService.ts
- ถ้าได้ credentials เพิ่ม ต้องแก้ 3 ไฟล์: env.ts (zod schema), huaweiService.ts (สร้าง instance), huaweiPool.ts (เพิ่มใน huaweiClients + PURPOSE_ORDER) — cron.ts ไม่ต้องแก้แล้วเพราะใช้ Object.values()
- 407 เป็น per-account rate limit ไม่ใช่ org-wide — เพิ่ม account ช่วยลด 407 ได้จริง
- **getDevList daily quota แก้แล้ว** — device sync ใช้ inventory budget per tick (default 2) + TTL 24h ใน `_syncMonitoringTickInner` (syncService.ts) ไม่เรียก getDevList ทุก site ทุก tick อีกแล้ว
- **อย่าคำนวณ timing จาก throttle chain (6.5s) อย่างเดียว** — ต้องเช็ค daily quota ด้วย ดู `docs/smartpvms_rate_limiting_compact_for_ai.md`
- getDevRealKpi มี limit ต่อ 5 นาที (ไม่ใช่ต่อวัน) → เป็น API หลักที่ใช้ใน device sync ได้โดยไม่ติด daily limit
- getStationClientCandidates มี batchIndex parameter พร้อมใช้แล้ว — ระบบ rotation ทำงานด้วย rotate() function ใน huaweiPool.ts
- Alarm sync ใช้ batchIndex กระจาย account อยู่แล้ว (alarmSyncService.ts) — เป็นตัวอย่างที่ดี

---

# Deployment Architecture & Service Split (มี.ค. 2025)

## CE Cloud Infrastructure

Deploy บน CE Cloud (console.cloud.ce.kmitl.ac.th) — university cloud ของภาค CE, KMITL
- VPN ต้องเปิดก่อนถึง SSH ได้ (OpenVPN, ce-cloud-vpn.ovpn)
- Instance flavor: small (RAM/CPU จำกัด)
- OS: Ubuntu 22.04, bare metal Node.js + pm2 (ไม่ใช้ Docker บน production)

### Instances ที่มีอยู่

| Instance | Internal IP | หน้าที่ | สถานะ |
|----------|-------------|---------|--------|
| `postgres-db` | 10.240.68.192 | PostgreSQL + Redis | ✅ running |
| `minio-backend` | 10.240.68.52 | MinIO file storage | ✅ running |
| `solar-admin-dev` | 10.240.68.20 | Frontend (NOT backend) | ✅ running |
| `solar-api` | 10.240.68.114 | Express API server (DISABLE_CRON=1, USE_QUEUE=true) | ✅ deployed |
| `solar-worker` | 10.240.68.60 | Cron sync + Puppeteer PDF + Email Worker | ✅ deployed |

### Target Architecture

```
                                 ┌─────────────────┐
  solar-admin-dev (Frontend) ───▶│    solar-api     │
                                 │  Express API     │
                                 │  (port 3000)     │
                                 │  DISABLE_CRON=1  │
                                 └──────┬───────────┘
                                        │
                    ┌───────────────┬────┴────────────┐
                    ▼               ▼                  ▼
             ┌────────────┐  ┌──────────┐  ┌───────────────┐
             │ postgres-db │  │  minio-  │  │ solar-worker  │
             │ PostgreSQL  │  │ backend  │  │               │
             │ + Redis     │  │  MinIO   │  │ Huawei Sync   │
             │             │  │          │  │ Puppeteer PDF  │
             │             │  │          │  │ Email Worker   │
             └────────────┘  └──────────┘  └───────────────┘
```

---

## สิ่งที่ทำไปแล้ว (Phase 1: Basic Split)

### 1. สร้าง `src/worker.ts` — Worker entrypoint
- Standalone process สำหรับ cron sync jobs
- มี `/healthz`, `/readyz` endpoint สำหรับ monitoring
- ไม่มี API routes — เบากว่า app.ts
- Default port 3001 (ผ่าน `WORKER_PORT`)

### 2. เพิ่ม npm scripts ใน `package.json`
```bash
npm run start          # รันทุกอย่างรวมกัน (เดิม)
npm run start:api      # DISABLE_CRON=1 node dist/app.js (API only)
npm run start:worker   # node dist/worker.js (cron only)
```

### 3. อัพเดท `docker-compose.yml`
- เพิ่ม `api` service (port 3000, DISABLE_CRON=1)
- เพิ่ม `worker` service (port 3001, worker.js)
- ทั้งคู่ชี้ไปที่ postgres + minio เดิม

### 4. อัพเดท `.env.example`
- เพิ่ม comment อธิบาย deployment mode (DISABLE_CRON, WORKER_PORT)

### สิ่งที่ยังไม่ได้ทำ (Phase 1)
- `DISABLE_CRON=1` ใน app.ts ทำงานได้อยู่แล้ว (มีมาก่อน) แต่ API ยังเรียก `huaweiService.ensureLoggedIn()` ตอน startup + `/readyz` — ไม่จำเป็นสำหรับ API-only mode
- Puppeteer + Email ยังถูกเรียกจาก API routes ตรง ๆ ยังไม่ได้ย้ายไป Worker

---

## Phase B Progress: Redis + BullMQ Queue System

### ✅ สิ่งที่ทำแล้ว (Step 4-6, 2026-03-26)

**Step 4: Install dependencies**
- `bullmq` + `ioredis` added to package.json

**Step 5: Redis config + env vars**
- `src/config/redis.ts` — connection factory:
  - `getRedisConnection()` — shared connection (สำหรับ Queue producer ฝั่ง API)
  - `createRedisConnection()` — dedicated connection (สำหรับ BullMQ Worker แต่ละตัว)
  - `closeRedisConnection()` — graceful shutdown
- `src/config/env.ts` — เพิ่ม `REDIS_HOST` (default 127.0.0.1), `REDIS_PORT` (default 6379), `REDIS_PASSWORD`, `USE_QUEUE`
- `.env.example` — เพิ่ม Redis section

**Step 6: Queue definitions + types**
- `src/jobs/types.ts` — interfaces:
  - `ReportJobData` — `{ jobId: number, jobType: 'cleaning' | 'service' }`
  - `ReportJobResult` — `{ fileUrl: string }`
  - `EmailJobData` — `{ jobId, step, source, to, subject, html, attachments? }`
  - `EmailJobResult` — `{ success, messageId?, accepted?, rejected?, error? }`
- `src/jobs/queues.ts` — 2 queues:
  - `report-generation` — attempts: 2, backoff: exponential 5s, keep completed 24h
  - `email-sending` — attempts: 3, backoff: exponential 3s, keep completed 24h

**Step 7: Report processor** (`src/jobs/processors/reportProcessor.ts`)
- `processReportJob(job)` — receives `{ jobId, jobType }` from BullMQ
- Handles both `cleaning` and `service` report types
- Full logic extracted from `cleaningController.generateReport` + `serviceController.generateReport`:
  - DB queries (job + attachments + site/layouts)
  - File resolution via `tryEnsureLocalFilePath()`
  - Evidence grouping (cleaning) / form images (service)
  - Calls `generateCleaningReportPdf()` or `generateServiceReportPdf()`
  - Updates DB: `cleaningJob.reportFileUrl` / `serviceJob.reportFileUrl`, creates `JobAttachment`, bumps job step to 4
- Reports progress: 10% → 40% → 90% → 100%

**Step 8: Email processor** (`src/jobs/processors/emailProcessor.ts`)
- `processEmailJob(job)` — receives `{ jobId, step, source, to, subject, html, attachments? }`
- Calls `sendEmailNow()` from emailService
- Throws on failure (triggers BullMQ retry with exponential backoff)
- Note: post-send DB updates (step2SentAt, status changes) still done by controllers after polling task status

**Step 9: Wire into worker.ts**
- `startQueueWorkers()` function — only runs when `USE_QUEUE=true`
- Report worker: concurrency=1 (Puppeteer is resource-heavy)
- Email worker: concurrency=3
- Both log completed/failed events
- Each worker uses its own dedicated Redis connection via `createRedisConnection()`

**Step 10: Task status endpoint** (2026-03-26)
- `src/routes/taskRoutes.ts` — `GET /api/tasks/:taskId?queue=report-generation|email-sending`
- Returns: `{ state, progress, result, failedReason }`
- Registered ใน `src/app.ts` → `/api/tasks`

**Step 11-13: Controller refactor** (2026-03-26)
- ทุก controller ใช้ pattern เดียวกัน: `if (getEnv().USE_QUEUE)` → enqueue + return taskId, else → direct call (fallback)
- **cleaningController**: `generateReport` (report queue), `sendStep2Email` + `sendStep5Email` (email queue)
- **serviceController**: `generateReport` (report queue), `sendStep2Email` + `sendStep5Email` (email queue)
- **inspectionController**: `sendStep2Email` + `sendStep3Email` (email queue, ไม่มี report — inspection ใช้ upload)
- `USE_QUEUE=false` (default) → ทำงานเหมือนเดิมทุกอย่าง ไม่ต้อง Redis
- `USE_QUEUE=true` → enqueue เข้า BullMQ, return `{ taskId, status: 'queued' }`, frontend poll `/api/tasks/:taskId`
- Email: optimistic DB update (mark as sent ทันทีหลัง enqueue — ไม่รอ worker ส่งเสร็จ)

---

## แผนที่จะทำต่อ (Phase B: Redis + BullMQ Queue System)

### เป้าหมาย
ย้าย Puppeteer PDF generation + Email sending จาก API → Worker ผ่าน BullMQ job queue
ให้ API เบา (รับ request → enqueue → return taskId ทันที) และ Worker ทำงานหนักแทน

### สถานะปัจจุบันที่ต้องรู้ก่อน refactor

Puppeteer ถูกเรียกจาก:
- `cleaningController.generateReport` → `generateCleaningReportPdf()` จาก `reportService.ts`
- `serviceController.generateReport` → `generateServiceReportPdf()` จาก `reportService.ts`

Email (sendEmailNow) ถูกเรียกจาก:
- `cleaningController.ts` → `sendStep2Email`, `sendStep5Email`
- `serviceController.ts` → `sendStep2Email`, `sendStep5Email`
- `inspectionController.ts` → `sendStep2Email`, `sendStep3Email`

### Step-by-Step Implementation Plan

#### Step 1: Dependencies + Redis Config
- เพิ่ม `bullmq` + `ioredis` ใน `package.json`
- สร้าง `src/config/redis.ts` — Redis connection factory
- เพิ่มใน `src/config/env.ts`: `REDIS_HOST` (default localhost), `REDIS_PORT` (default 6379), `REDIS_PASSWORD`
- อัพเดท `.env.example` เพิ่ม Redis section

#### Step 2: Queue Definitions + Job Types
- สร้าง `src/jobs/queues.ts` — 2 queues: `report-generation`, `email-sending`
- สร้าง `src/jobs/types.ts` — TypeScript interfaces: `ReportJobData`, `EmailJobData`

Queue config:
- Report: attempts 2, exponential backoff 5s, keep completed 24h
- Email: attempts 3, exponential backoff 3s, keep completed 24h

#### Step 3: Worker Processors
- สร้าง `src/jobs/processors/reportProcessor.ts`
  - รับ `ReportJobData` → อ่าน DB → เรียก Puppeteer → save report → update DB
  - ย้าย logic จาก `cleaningController.generateReport` + `serviceController.generateReport`
- สร้าง `src/jobs/processors/emailProcessor.ts`
  - รับ `EmailJobData` → resolve attachments → เรียก `sendEmailNow()` → update DB
  - ย้าย logic จาก controllers ทั้ง 3 ตัว

#### Step 4: Wire Processors เข้า Worker
- แก้ `src/worker.ts` เพิ่ม BullMQ Worker instances:
  - report-generation worker (concurrency: 1 — Puppeteer หนัก)
  - email-sending worker (concurrency: 3)

#### Step 5: Task Status Endpoint
- สร้าง `src/routes/taskRoutes.ts` — `GET /api/tasks/:taskId?queue=report-generation`
  - Return: `{ state, progress, result, failedReason }`
  - state: waiting | active | completed | failed | delayed
- Register ใน `src/app.ts`

Frontend polling: หลังได้ taskId → poll ทุก 2-3 วินาที จนกว่า state === completed/failed

#### Step 6: Refactor Controllers (งานหนักสุด — 8 functions)

| Controller | Function | เปลี่ยนจาก | เป็น |
|---|---|---|---|
| cleaningController | `generateReport` | call Puppeteer ตรง | enqueue to report queue |
| cleaningController | `sendStep2Email` | call sendEmailNow ตรง | enqueue to email queue |
| cleaningController | `sendStep5Email` | call sendEmailNow ตรง | enqueue to email queue |
| serviceController | `generateReport` | call Puppeteer ตรง | enqueue to report queue |
| serviceController | `sendStep2Email` | call sendEmailNow ตรง | enqueue to email queue |
| serviceController | `sendStep5Email` | call sendEmailNow ตรง | enqueue to email queue |
| inspectionController | `sendStep2Email` | call sendEmailNow ตรง | enqueue to email queue |
| inspectionController | `sendStep3Email` | call sendEmailNow ตรง | enqueue to email queue |

Pattern การเปลี่ยน:
```ts
// Before (synchronous)
const result = await generateCleaningReportPdf(data);
res.json({ success: true, reportUrl: result.url });

// After (async via queue)
const task = await getReportQueue().add('generate', { jobId: id, jobType: 'cleaning' });
res.json({ success: true, data: { taskId: task.id, status: 'queued' } });
```

#### Step 7: Fallback Flag
- เพิ่ม env `USE_QUEUE` (default true)
- ถ้า `USE_QUEUE=false` → run synchronous แบบเดิม (สำหรับ dev / Redis ล่ม)

#### สิ่งที่ต้องระวัง
- **Frontend ต้องเปลี่ยนด้วย** — ตอนนี้ frontend คาดว่าจะได้ reportUrl กลับทันที แต่แบบใหม่ได้ taskId แล้วต้อง poll
- **Puppeteer บน worker instance** ต้องติดตั้ง `chromium-browser` (`sudo apt install -y chromium-browser`)
- **Shared files** — ทั้ง API + Worker เข้าถึง MinIO ด้วย internal IP เดียวกัน (OK)
- **Redis memory** — 128MB เพียงพอสำหรับ BullMQ metadata (job payloads เป็นแค่ IDs + text)

---

## Thai Font in PDF Reports (Puppeteer)

### ปัญหา

Puppeteer `setContent()` ใช้ `about:blank` เป็น base URL → Chromium บล็อก `file://` URL → `@font-face src: url('file:///...')` โหลดไม่ได้ → ภาษาไทยในรายงาน PDF กลายเป็น กล่องสี่เหลี่ยม

### วิธีแก้ (commit 445d78a)

`src/services/reportTemplates/utils.ts` — `getFontFaceCss()`:
- อ่านไฟล์ font แล้ว encode เป็น base64 → embed ตรงใน CSS `@font-face src: url('data:font/truetype;base64,...')`
- ไม่ใช้ `file://` อีกต่อไป → Chromium โหลดได้แน่นอน

Font candidates (ลำดับตรวจสอบ):
1. `assets/fonts/THSarabunNew.ttf` (project asset)
2. `/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf` (system — installed บน solar-worker)
3. `/usr/share/fonts/truetype/noto-sans-thai/NotoSansThai-Regular.ttf`
4. `/usr/share/fonts/opentype/noto/NotoSansThai-Regular.ttf`

ถ้าหาไม่เจอสักทาง → ใช้ system font stack (fallback — อาจยังพัง)

### ข้อควรระวัง

- font file ใหญ่ (NotoSansThai ~500KB) → base64 ทำให้ HTML string ใหญ่ขึ้น ~700KB → เป็นเรื่องปกติ
- ถ้าเพิ่ม font ใหม่หรือเปลี่ยน font path ต้องแก้ candidates list ใน `getFontFaceCss()`
- `PUPPETEER_EXECUTABLE_PATH` env var override Chromium path ได้

---

## สิ่งที่รอ Verify / Pending

| งาน | สถานะ | หมายเหตุ |
|-----|--------|----------|
| Thai font PDF — verify หลัง deploy | ⏳ รอ frontend dev ทดสอบ | commit 445d78a deploy แล้ว — ให้ frontend สร้างรายงานและดู PDF |
| Domain + SSL (nginx) | ⏳ ยังไม่ได้ domain | ต้องการอย่างน้อย 2 domains: frontend + API |
| CORS บน solar-api | ⏳ รอ frontend domain | ตอนนี้ allow all origins (dev mode) |
| Redis `maxmemory-policy noeviction` | ⏳ low priority | ตั้งบน postgres-db instance |

---

## CI/CD Pipeline Plan

### สถานะปัจจุบัน
- CI มีอยู่แล้ว: `.github/workflows/ci.yml` (build + test + type-check)
- CD ยังไม่มี — push ไป GitHub ไม่มี auto deploy
- CE Cloud ต้อง VPN → GitHub Actions runner ปกติ SSH เข้าไม่ได้

### แผน: Self-hosted GitHub Actions Runner บน CE Cloud

```
push to main
    │
    ▼
┌──────────────────────────────────┐
│  GitHub Actions (cloud runner)    │
│  1. npm ci                        │
│  2. tsc --noEmit                  │
│  3. npm test                      │
│  4. npm run build                 │
│  5. upload dist/ as artifact      │
└───────────────┬──────────────────┘
                │ artifact download
     ┌──────────┼──────────┐
     ▼                     ▼
┌──────────┐       ┌─────────────┐
│solar-api │       │solar-worker │
│(runner:  │       │(runner:     │
│ce-cloud) │       │ce-cloud-    │
│          │       │worker)      │
│npm ci    │       │npm ci       │
│prisma    │       │pm2 restart  │
│migrate   │       │solar-worker │
│pm2 restart│      │             │
│solar-api │       │             │
└──────────┘       └─────────────┘
```

### ไฟล์ที่ต้องสร้าง
- `.github/workflows/deploy.yml`
  - Job 1 `build` (runs-on: ubuntu-latest): build + test + upload artifact
  - Job 2 `deploy-api` (runs-on: [self-hosted, ce-cloud]): download artifact → npm ci --omit=dev → prisma migrate deploy → pm2 restart solar-api
  - Job 3 `deploy-worker` (runs-on: [self-hosted, ce-cloud-worker]): download artifact → npm ci --omit=dev → pm2 restart solar-worker

### Manual Setup ที่ต้องทำบน CE Cloud (ครั้งเดียว)

1. **postgres-db instance** — ติดตั้ง Redis: ✅ ทำแล้ว (2026-03-25)
   - Redis 6.x running on 10.240.68.192:6379
   - bind 0.0.0.0, requirepass ตั้งแล้ว, maxmemory 128mb, appendonly yes
   - Password: ตั้งไว้แล้ว (อยู่ใน .env ของแต่ละ instance)
   - ✅ ทดสอบ connect ข้าม instance แล้ว (2026-03-26) — solar-api + solar-worker ได้ PONG ทั้งคู่

2. **solar-api instance** — ติดตั้ง self-hosted runner:
   ```bash
   # GitHub → Settings → Actions → Runners → New self-hosted runner
   # Label: ce-cloud
   # ติดตั้งเป็น systemd service: sudo ./svc.sh install && sudo ./svc.sh start
   ```

3. **solar-worker instance** — ติดตั้ง self-hosted runner + Chromium:
   ```bash
   # Label: ce-cloud-worker
   sudo apt install -y chromium-browser
   ```

### Environment Variables บน CE Cloud

solar-api:
```
PORT=3000
DISABLE_CRON=1
USE_QUEUE=true
DATABASE_URL=postgresql://admin:xxx@10.240.68.192:5432/solar_db
MINIO_ENDPOINT=http://10.240.68.52:9000
REDIS_HOST=10.240.68.192
REDIS_PORT=6379
REDIS_PASSWORD=xxx
```

solar-worker:
```
WORKER_PORT=3001
USE_QUEUE=true
DATABASE_URL=postgresql://admin:xxx@10.240.68.192:5432/solar_db
MINIO_ENDPOINT=http://10.240.68.52:9000
REDIS_HOST=10.240.68.192
REDIS_PORT=6379
REDIS_PASSWORD=xxx
HUAWEI_USER=xxx
HUAWEI_PASSWORD=xxx
# ... (all Huawei credentials)
```

---

## Implementation Sequence (ลำดับทำงาน)

| ลำดับ | งาน | ไฟล์ | ความเสี่ยง | สถานะ |
|---|---|---|---|---|
| 1 | worker.ts entrypoint | `src/worker.ts` | ต่ำ | ✅ ทำแล้ว |
| 2 | npm scripts (start:api, start:worker) | `package.json` | ต่ำ | ✅ ทำแล้ว |
| 3 | docker-compose update | `docker-compose.yml` | ต่ำ | ✅ ทำแล้ว |
| 4 | Install bullmq + ioredis | `package.json` | ต่ำ | ✅ ทำแล้ว (2026-03-26) |
| 5 | Redis config module | `src/config/redis.ts`, `src/config/env.ts`, `.env.example` | ต่ำ | ✅ ทำแล้ว (2026-03-26) |
| 6 | Queue definitions + types | `src/jobs/queues.ts`, `src/jobs/types.ts` | ต่ำ | ✅ ทำแล้ว (2026-03-26) |
| 7 | Report processor | `src/jobs/processors/reportProcessor.ts` | กลาง | ✅ ทำแล้ว (2026-03-26) |
| 8 | Email processor | `src/jobs/processors/emailProcessor.ts` | กลาง | ✅ ทำแล้ว (2026-03-26) |
| 9 | Wire processors เข้า worker.ts | `src/worker.ts` | ต่ำ | ✅ ทำแล้ว (2026-03-26) |
| 10 | Task status endpoint | `src/routes/taskRoutes.ts`, `src/app.ts` | ต่ำ | ✅ ทำแล้ว (2026-03-26) |
| 11 | Refactor cleaning controller | `src/controllers/cleaningController.ts` | กลาง | ✅ ทำแล้ว (2026-03-26) |
| 12 | Refactor service controller | `src/controllers/serviceController.ts` | กลาง | ✅ ทำแล้ว (2026-03-26) |
| 13 | Refactor inspection controller | `src/controllers/inspectionController.ts` | ต่ำ | ✅ ทำแล้ว (2026-03-26) |
| 14 | Docker compose + Redis service | `docker-compose.yml` | ต่ำ | ✅ ทำแล้ว (2026-03-26) |
| 15 | Deploy workflow | `.github/workflows/deploy.yml` | กลาง | ✅ ทำแล้ว (2026-03-26) |
| 16 | Install Redis on postgres-db | Manual SSH | ต่ำ | ✅ ทำแล้ว |
| 17 | Setup self-hosted runners (solar-api + solar-worker) | Manual SSH | กลาง | ✅ ทำแล้ว (2026-03-27) |
| 18 | ตั้ง .env บน solar-api (PORT, DISABLE_CRON, USE_QUEUE, DB, MinIO, Redis) | Manual SSH | ต่ำ | ✅ ทำแล้ว |
| 19 | ตั้ง .env บน solar-worker (Huawei credentials ครบ 5 accounts, USE_QUEUE, DISABLE_CRON ออก) | Manual SSH | ต่ำ | ✅ ทำแล้ว |
| 20 | Thai font fix (base64 data URI ใน CSS @font-face) | `src/services/reportTemplates/utils.ts` | กลาง | ✅ ทำแล้ว (commit 445d78a) — รอ verify |
| 21 | อัพเดท README วิธีต่อ cloud API สำหรับ frontend devs | `README.md` | ต่ำ | ✅ ทำแล้ว |
