import { z } from 'zod/v4';

const boolStr = z.string().optional().transform((v) => v === '1' || v === 'true');

const numStr = (fallback: number) =>
  z.string().optional().transform((v) => {
    if (v == null || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  });

const envSchema = z.object({
  // ── Core ──
  PORT: numStr(3000),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // ── Dev mode: skip Huawei sync & cron jobs ──
  DISABLE_CRON: boolStr,

  // ── Huawei API credentials (optional when DISABLE_CRON=1) ──
  HUAWEI_USER: z.string().optional().default(''),
  HUAWEI_PASSWORD: z.string().optional().default(''),
  HUAWEI_API_BASE_URL: z.string().url().optional().default('https://intl.fusionsolar.huawei.com'),
  HUAWEI_ALARM_USER: z.string().optional(),
  HUAWEI_ALARM_PASSWORD: z.string().optional(),
  HUAWEI_BACKUP_USER: z.string().optional(),
  HUAWEI_BACKUP_PASSWORD: z.string().optional(),
  HUAWEI_ONDEMAND_USER: z.string().optional(),
  HUAWEI_ONDEMAND_PASSWORD: z.string().optional(),
  HUAWEI_EXTRA1_USER: z.string().optional(),
  HUAWEI_EXTRA1_PASSWORD: z.string().optional(),

  // ── Huawei rate limiting ──
  HUAWEI_MIN_INTERVAL_MS: numStr(6500),
  HUAWEI_CIRCUIT_BREAKER_THRESHOLD: numStr(5),
  HUAWEI_CIRCUIT_BREAKER_RESET_MS: numStr(120_000),
  HUAWEI_BUDGET_WINDOW_MS: numStr(60_000),
  HUAWEI_BUDGET_MAX_REQUESTS: numStr(0),

  // ── Sync tuning ──
  HUAWEI_DEV_BATCH_SIZE: numStr(100),
  HUAWEI_SITE_REALTIME_BATCH_SIZE: numStr(100),
  HUAWEI_SITE_REALTIME_CONCURRENCY: numStr(2),
  HUAWEI_DEVICE_SYNC_CONCURRENCY: numStr(0), // 0 = auto
  HUAWEI_MIN_TICK_INTERVAL_MS: numStr(60_000),
  HUAWEI_SNAPSHOT_SLOT_MS: numStr(300_000),
  HUAWEI_STATION_CACHE_TTL_MS: numStr(6 * 60 * 60_000),
  HUAWEI_DEVICE_META_TTL_MS: numStr(24 * 60 * 60_000),
  HUAWEI_RETRY_QUEUE_MAX: numStr(500),
  HUAWEI_SYNC_TIMEZONE: z.string().optional().default('Asia/Bangkok'),

  // ── Alarm sync ──
  HUAWEI_ALARM_LOOKBACK_DAYS: numStr(30),
  HUAWEI_ALARM_INCREMENTAL_LOOKBACK_HOURS: numStr(6),
  HUAWEI_ALARM_FULL_SWEEP_INTERVAL_MS: numStr(6 * 60 * 60_000),
  HUAWEI_ALARM_BATCH_SIZE: numStr(100),
  HUAWEI_ALARM_CLEAR_MISS_THRESHOLD: numStr(2),
  HUAWEI_ALARM_CLEAR_MIN_ABSENCE_MS: numStr(60 * 60_000),

  // ── Redis (BullMQ) ──
  REDIS_HOST: z.string().optional().default('127.0.0.1'),
  REDIS_PORT: numStr(6379),
  REDIS_PASSWORD: z.string().optional(),
  USE_QUEUE: boolStr,

  // ── Debug ──
  HUAWEI_API_DEBUG: boolStr,
  SYNC_DEBUG: boolStr,
});

export type Env = z.infer<typeof envSchema>;

let validated: Env | null = null;

export function validateEnv(): Env {
  if (validated) return validated;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = z.prettifyError(result.error);
    console.error('========================================');
    console.error(' ENVIRONMENT VALIDATION FAILED');
    console.error('========================================');
    console.error(errors);
    console.error('========================================');
    process.exit(1);
  }

  validated = result.data;
  return validated;
}

export function getEnv(): Env {
  if (!validated) return validateEnv();
  return validated;
}
