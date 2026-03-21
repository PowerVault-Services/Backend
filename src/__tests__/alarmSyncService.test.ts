import { __testUtils } from '../services/alarmSyncService';

const {
  chunk,
  toDate,
  summarizeTopPlants,
  makeHuaweiAlarmKey,
  asObject,
  extractSyncMeta,
  mergeAlarmRaw,
  clampInt,
  buildRollingWindows,
  ALARM_STATES,
  ALARM_TRANSITIONS,
  isValidAlarmTransition,
  assertAlarmTransition,
} = __testUtils;

// ──────────────────────── chunk ────────────────────────

describe('chunk (alarm)', () => {
  it('splits array correctly', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns empty for empty input', () => {
    expect(chunk([], 5)).toEqual([]);
  });
});

// ──────────────────────── toDate ────────────────────────

describe('toDate', () => {
  it('converts valid ms timestamp to Date', () => {
    const ms = 1700000000000;
    const result = toDate(ms);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(ms);
  });

  it('returns null for 0', () => {
    expect(toDate(0)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(toDate(undefined)).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(toDate(NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(toDate(Infinity)).toBeNull();
  });
});

// ──────────────────────── summarizeTopPlants ────────────────────────

describe('summarizeTopPlants', () => {
  it('summarizes plant codes by count', () => {
    const items = [
      { stationCode: 'A' },
      { stationCode: 'A' },
      { stationCode: 'B' },
    ];
    const result = summarizeTopPlants(items);
    expect(result).toBe('A:2, B:1');
  });

  it('limits to topN', () => {
    const items = [
      { stationCode: 'A' },
      { stationCode: 'B' },
      { stationCode: 'C' },
    ];
    const result = summarizeTopPlants(items, 2);
    // Should only have 2 entries
    expect(result.split(', ').length).toBe(2);
  });

  it('handles missing stationCode', () => {
    const items = [{ other: 'value' }];
    const result = summarizeTopPlants(items);
    expect(result).toBe('NA:1');
  });
});

// ──────────────────────── makeHuaweiAlarmKey ────────────────────────

describe('makeHuaweiAlarmKey', () => {
  it('creates key from alarmId, raiseTime, esnCode', () => {
    const key = makeHuaweiAlarmKey({ alarmId: '100', raiseTime: '12345', esnCode: 'ESN001' });
    expect(key).toBe('100:12345:ESN001');
  });

  it('uses NA for missing fields', () => {
    const key = makeHuaweiAlarmKey({});
    expect(key).toBe('NA:0:NA');
  });

  it('handles null input', () => {
    const key = makeHuaweiAlarmKey(null);
    expect(key).toBe('NA:0:NA');
  });
});

// ──────────────────────── asObject ────────────────────────

describe('asObject', () => {
  it('returns the same object for valid object', () => {
    const obj = { a: 1 };
    expect(asObject(obj)).toBe(obj);
  });

  it('returns empty object for null', () => {
    expect(asObject(null)).toEqual({});
  });

  it('returns empty object for array', () => {
    expect(asObject([1, 2])).toEqual({});
  });

  it('returns empty object for primitives', () => {
    expect(asObject('string')).toEqual({});
    expect(asObject(42)).toEqual({});
    expect(asObject(undefined)).toEqual({});
  });
});

// ──────────────────────── extractSyncMeta ────────────────────────

describe('extractSyncMeta', () => {
  it('extracts _sync from raw object', () => {
    const raw = { _sync: { lastSeenAt: '2025-01-01', missCount: 2 } };
    expect(extractSyncMeta(raw)).toEqual({ lastSeenAt: '2025-01-01', missCount: 2 });
  });

  it('returns empty object if no _sync', () => {
    expect(extractSyncMeta({ data: 'test' })).toEqual({});
  });

  it('returns empty object for null', () => {
    expect(extractSyncMeta(null)).toEqual({});
  });
});

// ──────────────────────── mergeAlarmRaw ────────────────────────

describe('mergeAlarmRaw', () => {
  it('merges existing and incoming raw data', () => {
    const existing = { field1: 'old', _meta: { a: 1 }, _sync: { missCount: 1 } };
    const incoming = { field1: 'new', field2: 'added' };
    const syncPatch = { missCount: 0, lastSeenAt: 'now' };

    const result = mergeAlarmRaw(existing, incoming, syncPatch);
    expect(result.field1).toBe('new'); // incoming overrides
    expect(result.field2).toBe('added');
    expect(result._sync.missCount).toBe(0); // syncPatch overrides
    expect(result._sync.lastSeenAt).toBe('now');
    expect(result._meta.a).toBe(1); // existing _meta preserved
  });

  it('handles empty existing', () => {
    const result = mergeAlarmRaw({}, { name: 'test' }, { lastSeenAt: 'now' });
    expect(result.name).toBe('test');
    expect(result._sync.lastSeenAt).toBe('now');
  });
});

// ──────────────────────── clampInt ────────────────────────

describe('clampInt', () => {
  it('clamps to range', () => {
    expect(clampInt(5, 1, 10)).toBe(5);
    expect(clampInt(0, 1, 10)).toBe(1);
    expect(clampInt(15, 1, 10)).toBe(10);
  });

  it('truncates decimals', () => {
    expect(clampInt(3.7, 1, 10)).toBe(3);
  });

  it('returns min for NaN/Infinity', () => {
    expect(clampInt(NaN, 1, 10)).toBe(1);
    expect(clampInt(Infinity, 1, 10)).toBe(1);
  });
});

// ──────────────────────── buildRollingWindows ────────────────────────

describe('buildRollingWindows', () => {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('creates at least one window', () => {
    const windows = buildRollingWindows(now, 30);
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  it('first window endTime equals now', () => {
    const windows = buildRollingWindows(now, 30);
    expect(windows[0].endTime).toBe(now);
  });

  it('windows are contiguous (no gaps)', () => {
    const windows = buildRollingWindows(now, 90);
    for (let i = 1; i < windows.length; i++) {
      // Each window's endTime should be prev window's beginTime - 1
      expect(windows[i].endTime).toBe(windows[i - 1].beginTime - 1);
    }
  });

  it('respects maxLookbackDays', () => {
    const maxDays = 7;
    const windows = buildRollingWindows(now, maxDays);
    const lastWindow = windows[windows.length - 1];
    expect(lastWindow.beginTime).toBeGreaterThanOrEqual(now - maxDays * DAY_MS);
  });

  it('respects gridConnectionDate from siteMap', () => {
    const gridDate = new Date(now - 3 * DAY_MS);
    const siteMap = new Map([['S1', { id: 1, name: 'Site 1', gridConnectionDate: gridDate }]]);
    const windows = buildRollingWindows(now, 30, siteMap, ['S1']);
    const lastWindow = windows[windows.length - 1];
    // Should not go before gridConnectionDate
    expect(lastWindow.beginTime).toBeGreaterThanOrEqual(gridDate.getTime());
  });
});

// ──────────────────────── Alarm State Machine ────────────────────────

describe('Alarm State Machine', () => {
  it('defines exactly ACTIVE and CLEARED states', () => {
    expect(ALARM_STATES).toEqual(['ACTIVE', 'CLEARED']);
  });

  it('ACTIVE can only transition to CLEARED', () => {
    expect(ALARM_TRANSITIONS['ACTIVE']).toEqual(['CLEARED']);
  });

  it('CLEARED can only transition to ACTIVE (re-raise)', () => {
    expect(ALARM_TRANSITIONS['CLEARED']).toEqual(['ACTIVE']);
  });

  describe('isValidAlarmTransition', () => {
    it('allows null → ACTIVE (new alarm)', () => {
      expect(isValidAlarmTransition(null, 'ACTIVE')).toBe(true);
    });

    it('rejects null → CLEARED (cannot create as cleared)', () => {
      expect(isValidAlarmTransition(null, 'CLEARED')).toBe(false);
    });

    it('allows ACTIVE → CLEARED', () => {
      expect(isValidAlarmTransition('ACTIVE', 'CLEARED')).toBe(true);
    });

    it('allows CLEARED → ACTIVE (re-raise)', () => {
      expect(isValidAlarmTransition('CLEARED', 'ACTIVE')).toBe(true);
    });

    it('allows idempotent ACTIVE → ACTIVE', () => {
      expect(isValidAlarmTransition('ACTIVE', 'ACTIVE')).toBe(true);
    });

    it('allows idempotent CLEARED → CLEARED', () => {
      expect(isValidAlarmTransition('CLEARED', 'CLEARED')).toBe(true);
    });

    it('rejects unknown state → ACTIVE', () => {
      expect(isValidAlarmTransition('UNKNOWN', 'ACTIVE')).toBe(false);
    });
  });

  describe('assertAlarmTransition', () => {
    it('does not throw for valid transitions', () => {
      expect(() => assertAlarmTransition(null, 'ACTIVE', 'test')).not.toThrow();
      expect(() => assertAlarmTransition('ACTIVE', 'CLEARED', 'test')).not.toThrow();
    });

    it('throws for invalid transitions', () => {
      expect(() => assertAlarmTransition(null, 'CLEARED', 'test')).toThrow('Invalid alarm transition');
      expect(() => assertAlarmTransition('UNKNOWN', 'ACTIVE', 'test')).toThrow('Invalid alarm transition');
    });
  });
});
