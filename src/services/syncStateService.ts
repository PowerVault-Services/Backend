import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { projectRoot } from '../config/runtimePaths';
import prisma from '../config/prisma';

export type SyncJobName = 'siteRealtime' | 'device' | 'alarm';
export type SyncStationKind = 'siteRealtime' | 'device' | 'alarm';

type JobState = {
  running: boolean;
  lastStartAt: string | null;
  lastEndAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastResult: Record<string, any> | null;
  consecutiveFailures: number;
};

type SyncStateFile = {
  version: number;
  updatedAt: string;
  jobs: Record<SyncJobName, JobState>;
  stations: Record<SyncStationKind, Record<string, string>>;
};

const MAX_STATION_HISTORY = Math.max(5000, Number(process.env.HUAWEI_SYNC_STATE_MAX_STATIONS ?? 20000));
const JOB_NAMES: SyncJobName[] = ['siteRealtime', 'device', 'alarm'];

function createEmptyJobState(): JobState {
  return {
    running: false,
    lastStartAt: null,
    lastEndAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastResult: null,
    consecutiveFailures: 0,
  };
}

function createEmptyState(): SyncStateFile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    jobs: {
      siteRealtime: createEmptyJobState(),
      device: createEmptyJobState(),
      alarm: createEmptyJobState(),
    },
    stations: {
      siteRealtime: {},
      device: {},
      alarm: {},
    },
  };
}

let state: SyncStateFile = createEmptyState();
let hydratePromise: Promise<void> | null = null;
let persistTimer: NodeJS.Timeout | null = null;

// Dirty tracking — only persist what changed since last flush
const dirtyJobs = new Set<SyncJobName>();
const dirtyStations = new Set<string>(); // "kind:stationCode"

function ensureJobState(jobName: SyncJobName): JobState {
  state.jobs[jobName] = state.jobs[jobName] ?? createEmptyJobState();
  return state.jobs[jobName];
}

function pruneStationHistory(kind: SyncStationKind) {
  const entries = Object.entries(state.stations[kind] ?? {});
  if (entries.length <= MAX_STATION_HISTORY) return;

  entries.sort((a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime());
  state.stations[kind] = Object.fromEntries(entries.slice(0, MAX_STATION_HISTORY));
}

// ---------------------------------------------------------------------------
// Hydration: DB first, fall back to legacy JSON file for one-time migration
// ---------------------------------------------------------------------------

async function hydrateFromDb() {
  try {
    const jobCount = await prisma.huaweiSyncJob.count();

    if (jobCount === 0) {
      // First run after migration — try to seed from legacy JSON file
      const legacyFile = path.join(projectRoot, 'data', 'huawei-sync-state.json');
      if (fs.existsSync(legacyFile)) {
        try {
          const raw = await fsp.readFile(legacyFile, 'utf8');
          if (raw.trim()) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
              const merged = createEmptyState();
              merged.updatedAt = String(parsed.updatedAt ?? merged.updatedAt);

              for (const jobName of JOB_NAMES) {
                merged.jobs[jobName] = {
                  ...createEmptyJobState(),
                  ...((parsed.jobs ?? {})[jobName] ?? {}),
                };
                merged.jobs[jobName].running = false;
              }

              for (const kind of JOB_NAMES) {
                const existing = ((parsed.stations ?? {})[kind] ?? {}) as Record<string, string>;
                merged.stations[kind] = { ...existing };
              }

              state = merged;
              for (const kind of JOB_NAMES) pruneStationHistory(kind);

              // Persist migrated state to DB immediately
              for (const jobName of JOB_NAMES) dirtyJobs.add(jobName);
              for (const kind of JOB_NAMES) {
                for (const stationCode of Object.keys(state.stations[kind])) {
                  dirtyStations.add(`${kind}:${stationCode}`);
                }
              }
              await persistToDb();

              console.log('✅ Migrated Huawei sync state from JSON file → DB');
              return;
            }
          }
        } catch (e: any) {
          console.warn('⚠️ Could not migrate legacy JSON sync state:', e?.message);
        }
      }
      // No legacy file or parse failed — start fresh
      return;
    }

    // Normal DB hydration
    const merged = createEmptyState();

    const jobRows = await prisma.huaweiSyncJob.findMany();
    for (const row of jobRows) {
      const jobName = row.jobName as SyncJobName;
      if (!merged.jobs[jobName]) continue;
      merged.jobs[jobName] = {
        running: false, // always reset on startup
        lastStartAt: row.lastStartAt?.toISOString() ?? null,
        lastEndAt: row.lastEndAt?.toISOString() ?? null,
        lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
        lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
        lastError: row.lastError ?? null,
        lastResult: (row.lastResult as Record<string, any>) ?? null,
        consecutiveFailures: row.consecutiveFailures,
      };
    }

    const stationRows = await prisma.huaweiSyncStation.findMany();
    for (const row of stationRows) {
      const kind = row.kind as SyncStationKind;
      if (!merged.stations[kind]) continue;
      merged.stations[kind][row.stationCode] = row.lastSeenAt.toISOString();
    }

    state = merged;
    for (const kind of JOB_NAMES) pruneStationHistory(kind);
  } catch (error: any) {
    console.warn('⚠️ Unable to hydrate Huawei sync state from DB:', error?.message ?? error);
  }
}

export async function ensureSyncStateHydrated() {
  if (!hydratePromise) {
    hydratePromise = hydrateFromDb();
  }
  await hydratePromise;
}

// ---------------------------------------------------------------------------
// Persistence: flush dirty state to DB (debounced)
// ---------------------------------------------------------------------------

async function persistToDb() {
  try {
    state.updatedAt = new Date().toISOString();

    // Upsert dirty jobs
    const jobOps = [...dirtyJobs].map((jobName) => {
      const job = state.jobs[jobName];
      return prisma.huaweiSyncJob.upsert({
        where: { jobName },
        create: {
          jobName,
          running: job.running,
          lastStartAt: job.lastStartAt ? new Date(job.lastStartAt) : null,
          lastEndAt: job.lastEndAt ? new Date(job.lastEndAt) : null,
          lastSuccessAt: job.lastSuccessAt ? new Date(job.lastSuccessAt) : null,
          lastErrorAt: job.lastErrorAt ? new Date(job.lastErrorAt) : null,
          lastError: job.lastError,
          lastResult: job.lastResult ?? undefined,
          consecutiveFailures: job.consecutiveFailures,
        },
        update: {
          running: job.running,
          lastStartAt: job.lastStartAt ? new Date(job.lastStartAt) : null,
          lastEndAt: job.lastEndAt ? new Date(job.lastEndAt) : null,
          lastSuccessAt: job.lastSuccessAt ? new Date(job.lastSuccessAt) : null,
          lastErrorAt: job.lastErrorAt ? new Date(job.lastErrorAt) : null,
          lastError: job.lastError,
          lastResult: job.lastResult ?? undefined,
          consecutiveFailures: job.consecutiveFailures,
        },
      });
    });

    // Upsert dirty stations
    const stationOps = [...dirtyStations].map((key) => {
      const [kind, stationCode] = key.split(':', 2) as [SyncStationKind, string];
      const isoTs = state.stations[kind]?.[stationCode];
      if (!isoTs) return null;
      return prisma.huaweiSyncStation.upsert({
        where: { kind_stationCode: { kind, stationCode } },
        create: { kind, stationCode, lastSeenAt: new Date(isoTs) },
        update: { lastSeenAt: new Date(isoTs) },
      });
    }).filter(Boolean);

    // Batch in chunks of 50 inside transactions
    const allOps = [...jobOps, ...stationOps] as any[];
    for (let i = 0; i < allOps.length; i += 50) {
      await prisma.$transaction(allOps.slice(i, i + 50));
    }

    dirtyJobs.clear();
    dirtyStations.clear();
  } catch (error: any) {
    console.warn('⚠️ Unable to persist Huawei sync state to DB:', error?.message ?? error);
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    await persistToDb();
  }, 1000);
  persistTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Public API (unchanged signatures)
// ---------------------------------------------------------------------------

export function markJobStart(jobName: SyncJobName) {
  const job = ensureJobState(jobName);
  const nowIso = new Date().toISOString();
  job.running = true;
  job.lastStartAt = nowIso;
  state.updatedAt = nowIso;
  dirtyJobs.add(jobName);
  schedulePersist();
}

export function markJobSuccess(jobName: SyncJobName, result?: Record<string, any> | null) {
  const job = ensureJobState(jobName);
  const nowIso = new Date().toISOString();
  job.running = false;
  job.lastEndAt = nowIso;
  job.lastSuccessAt = nowIso;
  job.lastError = null;
  job.lastResult = result ?? null;
  job.consecutiveFailures = 0;
  state.updatedAt = nowIso;
  dirtyJobs.add(jobName);
  schedulePersist();
}

export function markJobFailure(jobName: SyncJobName, error: unknown, extra?: Record<string, any> | null) {
  const job = ensureJobState(jobName);
  const nowIso = new Date().toISOString();
  job.running = false;
  job.lastEndAt = nowIso;
  job.lastErrorAt = nowIso;
  job.lastError = error instanceof Error ? error.message : String(error ?? 'unknown error');
  job.lastResult = extra ?? null;
  job.consecutiveFailures += 1;
  state.updatedAt = nowIso;
  dirtyJobs.add(jobName);
  schedulePersist();
}

export function markStations(kind: SyncStationKind, stationCodes: string[], at = Date.now()) {
  if (!Array.isArray(stationCodes) || stationCodes.length === 0) return;
  const bucket = state.stations[kind] ?? (state.stations[kind] = {});
  const nowIso = new Date(at).toISOString();
  for (const stationCode of stationCodes) {
    if (!stationCode) continue;
    bucket[String(stationCode)] = nowIso;
    dirtyStations.add(`${kind}:${stationCode}`);
  }
  pruneStationHistory(kind);
  state.updatedAt = nowIso;
  schedulePersist();
}

export function getStationLastSeenMs(kind: SyncStationKind, stationCode: string): number | null {
  const value = state.stations[kind]?.[stationCode];
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function getStalestStationCodes(
  kind: SyncStationKind,
  stationCodes: string[],
  limit: number,
  opts?: { exclude?: Set<string> }
): string[] {
  const unique = Array.from(new Set(stationCodes.filter(Boolean)));
  const exclude = opts?.exclude ?? new Set<string>();

  return unique
    .filter((code) => !exclude.has(code))
    .sort((a, b) => {
      const aMs = getStationLastSeenMs(kind, a) ?? 0;
      const bMs = getStationLastSeenMs(kind, b) ?? 0;
      if (aMs === bMs) return a.localeCompare(b);
      return aMs - bMs;
    })
    .slice(0, Math.max(0, limit));
}

export function getSyncStateSnapshot() {
  return JSON.parse(JSON.stringify(state)) as SyncStateFile;
}
