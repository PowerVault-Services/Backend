// -------- Global Request Budget --------
// Prevents all jobs from collectively exceeding API rate limits per window.
const BUDGET_WINDOW_MS = Math.max(10_000, Number(process.env.HUAWEI_BUDGET_WINDOW_MS ?? 60_000));
const BUDGET_MAX_REQUESTS = Number(process.env.HUAWEI_BUDGET_MAX_REQUESTS ?? 0);
const budgetTimestamps: number[] = [];

function pruneExpiredBudgetEntries(now: number) {
  const cutoff = now - BUDGET_WINDOW_MS;
  while (budgetTimestamps.length > 0 && budgetTimestamps[0] < cutoff) {
    budgetTimestamps.shift();
  }
}

/** Record an API request against the global budget. */
export function recordBudgetRequest() {
  if (BUDGET_MAX_REQUESTS <= 0) return; // disabled
  budgetTimestamps.push(Date.now());
}

/** Check if the global budget is exhausted for the current window. */
export function isBudgetExhausted(): boolean {
  if (BUDGET_MAX_REQUESTS <= 0) return false; // disabled
  pruneExpiredBudgetEntries(Date.now());
  return budgetTimestamps.length >= BUDGET_MAX_REQUESTS;
}

/** Get remaining budget in current window. */
export function getBudgetRemaining(): number {
  if (BUDGET_MAX_REQUESTS <= 0) return Infinity;
  pruneExpiredBudgetEntries(Date.now());
  return Math.max(0, BUDGET_MAX_REQUESTS - budgetTimestamps.length);
}

/** Get budget snapshot for monitoring. */
export function getBudgetSnapshot() {
  pruneExpiredBudgetEntries(Date.now());
  return {
    enabled: BUDGET_MAX_REQUESTS > 0,
    windowMs: BUDGET_WINDOW_MS,
    maxRequests: BUDGET_MAX_REQUESTS,
    usedInWindow: budgetTimestamps.length,
    remaining: getBudgetRemaining(),
  };
}
