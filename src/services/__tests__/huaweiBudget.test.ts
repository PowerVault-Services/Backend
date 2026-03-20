describe('huaweiBudget', () => {
  // Re-import fresh module per test to reset internal state
  let budget: typeof import('../huaweiBudget');

  beforeEach(() => {
    jest.resetModules();
    // Enable budget with max 5 requests per window
    process.env.HUAWEI_BUDGET_MAX_REQUESTS = '5';
    process.env.HUAWEI_BUDGET_WINDOW_MS = '60000';
    budget = require('../huaweiBudget');
  });

  afterEach(() => {
    delete process.env.HUAWEI_BUDGET_MAX_REQUESTS;
    delete process.env.HUAWEI_BUDGET_WINDOW_MS;
  });

  it('starts with full budget', () => {
    expect(budget.isBudgetExhausted()).toBe(false);
    expect(budget.getBudgetRemaining()).toBe(5);
  });

  it('decrements remaining on record', () => {
    budget.recordBudgetRequest();
    budget.recordBudgetRequest();
    expect(budget.getBudgetRemaining()).toBe(3);
  });

  it('reports exhausted when limit reached', () => {
    for (let i = 0; i < 5; i++) budget.recordBudgetRequest();
    expect(budget.isBudgetExhausted()).toBe(true);
    expect(budget.getBudgetRemaining()).toBe(0);
  });

  it('getBudgetSnapshot returns correct shape', () => {
    budget.recordBudgetRequest();
    const snap = budget.getBudgetSnapshot();
    expect(snap).toEqual({
      enabled: true,
      windowMs: 60000,
      maxRequests: 5,
      usedInWindow: 1,
      remaining: 4,
    });
  });
});

describe('huaweiBudget (disabled)', () => {
  let budget: typeof import('../huaweiBudget');

  beforeEach(() => {
    jest.resetModules();
    process.env.HUAWEI_BUDGET_MAX_REQUESTS = '0';
    budget = require('../huaweiBudget');
  });

  afterEach(() => {
    delete process.env.HUAWEI_BUDGET_MAX_REQUESTS;
  });

  it('never exhausted when disabled', () => {
    for (let i = 0; i < 100; i++) budget.recordBudgetRequest();
    expect(budget.isBudgetExhausted()).toBe(false);
    expect(budget.getBudgetRemaining()).toBe(Infinity);
  });
});
