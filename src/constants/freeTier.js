/** Daily free chat decisions for logged-out guests and logged-in free-tier users (resets per calendar day). */
export const DAILY_FREE_DECISION_LIMIT = 10;

/** Canonical UI phrase for guest + free-tier daily chat quota (keep in sync with DAILY_FREE_DECISION_LIMIT). */
export function freeDecisionsPerDayLabel(limit = DAILY_FREE_DECISION_LIMIT) {
  return `${limit} free decisions per day`;
}
