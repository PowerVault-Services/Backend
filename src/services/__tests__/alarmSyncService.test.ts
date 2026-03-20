jest.mock('../../config/prisma', () => ({ default: {} }));
jest.mock('../huaweiService', () => ({
  huaweiMain: { getAccountKey: () => 'main', getLabels: () => ['main'], getCooldownRemainingMs: () => 0 },
  huaweiAlarm: { getAccountKey: () => 'alarm', getLabels: () => ['alarm'], getCooldownRemainingMs: () => 0 },
  huaweiBackup: { getAccountKey: () => 'backup', getLabels: () => ['backup'], getCooldownRemainingMs: () => 0 },
  huaweiOnDemand: { getAccountKey: () => 'ondemand', getLabels: () => ['ondemand'], getCooldownRemainingMs: () => 0 },
  HuaweiService: class {},
}));
jest.mock('../syncStateService', () => ({
  getStalestStationCodes: () => [],
  getStationLastSeenMs: () => ({}),
  getSyncStateSnapshot: () => ({ jobs: {}, stations: {} }),
  markStations: () => {},
}));

import { __testUtils as utils } from '../alarmSyncService';

describe('chunk()', () => {
  it('splits correctly', () => {
    expect(utils.chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });
  it('handles empty', () => {
    expect(utils.chunk([], 5)).toEqual([]);
  });
});

describe('toDate()', () => {
  it('converts valid ms timestamp', () => {
    const d = utils.toDate(1700000000000);
    expect(d).toBeInstanceOf(Date);
    expect(d!.getTime()).toBe(1700000000000);
  });

  it('returns null for undefined/0/NaN', () => {
    expect(utils.toDate(undefined)).toBeNull();
    expect(utils.toDate(0)).toBeNull();
    expect(utils.toDate(NaN)).toBeNull();
  });
});

describe('summarizeTopPlants()', () => {
  it('summarizes top plants by count', () => {
    const items = [
      { stationCode: 'A' },
      { stationCode: 'A' },
      { stationCode: 'B' },
    ];
    expect(utils.summarizeTopPlants(items)).toBe('A:2, B:1');
  });

  it('handles empty array', () => {
    expect(utils.summarizeTopPlants([])).toBe('');
  });

  it('limits to topN', () => {
    const items = [
      { stationCode: 'A' },
      { stationCode: 'B' },
      { stationCode: 'C' },
    ];
    const result = utils.summarizeTopPlants(items, 2);
    expect(result.split(', ').length).toBe(2);
  });

  it('uses NA for missing stationCode', () => {
    expect(utils.summarizeTopPlants([{}])).toBe('NA:1');
  });
});

describe('makeHuaweiAlarmKey()', () => {
  it('generates deterministic composite key', () => {
    const key = utils.makeHuaweiAlarmKey({ alarmId: 100, raiseTime: 12345, esnCode: 'ESN01' });
    expect(key).toBe('100:12345:ESN01');
  });

  it('defaults missing fields to NA/0', () => {
    expect(utils.makeHuaweiAlarmKey({})).toBe('NA:0:NA');
    expect(utils.makeHuaweiAlarmKey(null)).toBe('NA:0:NA');
  });
});

describe('asObject()', () => {
  it('returns object as-is', () => {
    const obj = { a: 1 };
    expect(utils.asObject(obj)).toBe(obj);
  });

  it('returns empty object for non-objects', () => {
    expect(utils.asObject(null)).toEqual({});
    expect(utils.asObject(undefined)).toEqual({});
    expect(utils.asObject('string')).toEqual({});
    expect(utils.asObject(42)).toEqual({});
    expect(utils.asObject([1, 2])).toEqual({});
  });
});

describe('extractSyncMeta()', () => {
  it('extracts _sync from raw', () => {
    const raw = { _sync: { lastSeenAt: 123 }, other: 'data' };
    expect(utils.extractSyncMeta(raw)).toEqual({ lastSeenAt: 123 });
  });

  it('returns empty object if no _sync', () => {
    expect(utils.extractSyncMeta({})).toEqual({});
    expect(utils.extractSyncMeta(null)).toEqual({});
  });
});

describe('mergeAlarmRaw()', () => {
  it('merges incoming over existing', () => {
    const existing = { field1: 'old', _meta: { a: 1 }, _sync: { missCount: 2 } };
    const incoming = { field1: 'new', field2: 'added', _meta: { b: 2 }, _sync: {} };
    const syncPatch = { lastSeenAt: 999 };

    const result = utils.mergeAlarmRaw(existing, incoming, syncPatch);
    expect(result.field1).toBe('new');
    expect(result.field2).toBe('added');
    expect(result._meta).toEqual({ b: 2, a: 1 }); // existing meta preserved
    expect(result._sync).toEqual({ missCount: 2, lastSeenAt: 999 }); // sync patched
  });

  it('handles both null', () => {
    const result = utils.mergeAlarmRaw(null, null, { x: 1 });
    expect(result._sync).toEqual({ x: 1 });
  });
});

describe('clampInt()', () => {
  it('clamps within range', () => {
    expect(utils.clampInt(5, 1, 10)).toBe(5);
    expect(utils.clampInt(0, 1, 10)).toBe(1);
    expect(utils.clampInt(15, 1, 10)).toBe(10);
  });

  it('truncates decimals', () => {
    expect(utils.clampInt(3.7, 1, 10)).toBe(3);
  });

  it('returns min for NaN/Infinity', () => {
    expect(utils.clampInt(NaN, 1, 10)).toBe(1);
    expect(utils.clampInt(Infinity, 1, 10)).toBe(1);
  });
});

describe('buildRollingWindows()', () => {
  const NOW = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('creates windows covering lookback period', () => {
    const windows = utils.buildRollingWindows(NOW, 60);
    expect(windows.length).toBeGreaterThan(0);
    // First window should end at NOW
    expect(windows[0].endTime).toBe(NOW);
    // Last window should reach back to oldest allowed
    const lastWindow = windows[windows.length - 1];
    expect(lastWindow.beginTime).toBeGreaterThanOrEqual(NOW - 60 * DAY_MS);
  });

  it('respects gridConnectionDate constraint', () => {
    const gridDate = new Date(NOW - 10 * DAY_MS);
    const siteMap = new Map<string, any>([['ST001', { gridConnectionDate: gridDate }]]);
    const windows = utils.buildRollingWindows(NOW, 180, siteMap, ['ST001']);

    const lastWindow = windows[windows.length - 1];
    expect(lastWindow.beginTime).toBeGreaterThanOrEqual(gridDate.getTime());
  });

  it('returns at least one window', () => {
    const windows = utils.buildRollingWindows(NOW, 1);
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  it('windows are contiguous (no gaps)', () => {
    const windows = utils.buildRollingWindows(NOW, 90);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].endTime).toBe(windows[i - 1].beginTime - 1);
    }
  });
});
