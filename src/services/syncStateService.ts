import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { projectRoot } from '../config/runtimePaths';

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

const dataDir = path.join(projectRoot, 'data');
const stateFile = path.join(dataDir, 'huawei-sync-state.json');
const MAX_STATION_HISTORY = Math.max(5000, Number(process.env.HUAWEI_SYNC_STATE_MAX_STATIONS ?? 20000));

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

async function hydrateFromDisk() {
  try {
    await fsp.mkdir(dataDir, { recursive: true });
    if (!fs.existsSync(stateFile)) return;
    const raw = await fsp.readFile(stateFile, 'utf8');
    if (!raw.trim()) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;

    const merged = createEmptyState();
    merged.updatedAt = String((parsed as any).updatedAt ?? merged.updatedAt);

    for (const jobName of ['siteRealtime', 'device', 'alarm'] as const) {
      merged.jobs[jobName] = {
        ...createEmptyJobState(),
        ...(((parsed as any).jobs ?? {})[jobName] ?? {}),
      };
      merged.jobs[jobName].running = false;
    }

    for (const kind of ['siteRealtime', 'device', 'alarm'] as const) {
      const existing = (((parsed as any).stations ?? {})[kind] ?? {}) as Record<string, string>;
      merged.stations[kind] = { ...existing };
    }

    state = merged;
    for (const kind of ['siteRealtime', 'device', 'alarm'] as const) {
      pruneStationHistory(kind);
    }
  } catch (error: any) {
    console.warn('⚠️ Unable to hydrate Huawei sync state:', error?.message ?? error);
  }
}

export async function ensureSyncStateHydrated() {
  if (!hydratePromise) {
    hydratePromise = hydrateFromDisk();
  }
  await hydratePromise;
}

async function persistNow() {
  try {
    state.updatedAt = new Date().toISOString();
    await fsp.mkdir(dataDir, { recursive: true });
    await fsp.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (error: any) {
    console.warn('⚠️ Unable to persist Huawei sync state:', error?.message ?? error);
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    await persistNow();
  }, 1000);
  persistTimer.unref?.();
}

export function markJobStart(jobName: SyncJobName) {
  const job = ensureJobState(jobName);
  const nowIso = new Date().toISOString();
  job.running = true;
  job.lastStartAt = nowIso;
  state.updatedAt = nowIso;
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
  schedulePersist();
}

export function markStations(kind: SyncStationKind, stationCodes: string[], at = Date.now()) {
  if (!Array.isArray(stationCodes) || stationCodes.length === 0) return;
  const bucket = state.stations[kind] ?? (state.stations[kind] = {});
  const nowIso = new Date(at).toISOString();
  for (const stationCode of stationCodes) {
    if (!stationCode) continue;
    bucket[String(stationCode)] = nowIso;
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

export function getSyncStateFilePath() {
  return stateFile;
}
