import { HuaweiService } from '../services/huaweiService';

// We test the class methods that don't require network/login

describe('HuaweiService', () => {
  let service: HuaweiService;

  beforeEach(() => {
    service = new HuaweiService({
      userName: 'test-user',
      systemCode: 'test-pass',
      label: 'TEST',
    });
  });

  // ──────────────────────── getAccountKey ────────────────────────

  describe('getAccountKey', () => {
    it('returns baseUrl::userName format', () => {
      const key = service.getAccountKey();
      expect(key).toContain('test-user');
      expect(key).toContain('::');
    });
  });

  // ──────────────────────── getLabels ────────────────────────

  describe('getLabels', () => {
    it('includes initial label', () => {
      expect(service.getLabels()).toContain('TEST');
    });

    it('includes registered aliases', () => {
      service.registerAlias('BACKUP');
      expect(service.getLabels()).toContain('TEST');
      expect(service.getLabels()).toContain('BACKUP');
    });

    it('ignores empty alias', () => {
      const before = service.getLabels().length;
      service.registerAlias('');
      service.registerAlias(null);
      expect(service.getLabels().length).toBe(before);
    });
  });

  // ──────────────────────── stats ────────────────────────

  describe('getStats / resetStats', () => {
    it('starts with zero stats', () => {
      const stats = service.getStats();
      expect(stats.totalRequests).toBe(0);
      expect(stats.login).toBe(0);
      expect(stats.stations).toBe(0);
    });

    it('returns a copy (not the internal object)', () => {
      const stats1 = service.getStats();
      stats1.totalRequests = 999;
      expect(service.getStats().totalRequests).toBe(0);
    });

    it('resetStats sets everything to 0', () => {
      // Force some state change by accessing internals via getRuntimeStatus
      service.resetStats();
      const stats = service.getStats();
      expect(Object.values(stats).every((v) => v === 0)).toBe(true);
    });
  });

  // ──────────────────────── cooldown ────────────────────────

  describe('cooldown', () => {
    it('isCoolingDown returns false initially', () => {
      expect(service.isCoolingDown()).toBe(false);
    });

    it('getCooldownRemainingMs returns 0 when not cooling', () => {
      expect(service.getCooldownRemainingMs()).toBe(0);
    });
  });

  // ──────────────────────── circuit breaker ────────────────────────

  describe('circuit breaker', () => {
    it('starts closed', () => {
      expect(service.isCircuitOpen()).toBe(false);
    });

    it('getRuntimeStatus includes circuit breaker info', () => {
      const status = service.getRuntimeStatus();
      expect(status).toHaveProperty('circuitBreakerOpen');
      expect(status).toHaveProperty('circuitBreakerFailures');
      expect(status.circuitBreakerOpen).toBe(false);
      expect(status.circuitBreakerFailures).toBe(0);
    });
  });

  // ──────────────────────── notifyRateLimit ────────────────────────

  describe('notifyRateLimit', () => {
    it('sets cooldown for personal rate limit', () => {
      service.notifyRateLimit({ kind: 'personal', delayMs: 5000 });
      expect(service.isCoolingDown()).toBe(true);
      expect(service.getCooldownRemainingMs()).toBeGreaterThan(0);
      expect(service.getCooldownRemainingMs()).toBeLessThanOrEqual(5000);
    });

    it('sets cooldown for system rate limit', () => {
      service.notifyRateLimit({ kind: 'system', delayMs: 3000 });
      expect(service.isCoolingDown()).toBe(true);
    });
  });

  // ──────────────────────── getRuntimeStatus ────────────────────────

  describe('getRuntimeStatus', () => {
    it('returns complete status object', () => {
      const status = service.getRuntimeStatus();
      expect(status).toHaveProperty('accountKey');
      expect(status).toHaveProperty('labels');
      expect(status).toHaveProperty('hasToken');
      expect(status).toHaveProperty('minIntervalMs');
      expect(status).toHaveProperty('baseMinIntervalMs');
      expect(status).toHaveProperty('cooldownRemainingMs');
      expect(status).toHaveProperty('stats');
      expect(status.hasToken).toBe(false);
    });
  });

  // ──────────────────────── ensureLoggedIn (missing creds) ────────────────────────

  describe('ensureLoggedIn with missing credentials', () => {
    it('throws when credentials are empty', async () => {
      const noCredService = new HuaweiService({
        userName: '',
        systemCode: '',
        label: 'EMPTY',
      });

      await expect(noCredService.ensureLoggedIn()).rejects.toThrow('Missing Huawei credentials');
    });
  });
});
