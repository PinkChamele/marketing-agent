export const DEFAULT_BUDGET_CHARS = 40_000;

/**
 * Numeric / market-size signal — dollar amounts, percentages, CAGR/YoY
 * mentions. Sections containing these are usually what research is hunting for,
 * so chunks matching this get a scoring bonus.
 */
export const NUMERIC_SIGNAL =
  /\$[\d,.]+\s*(?:bn|billion|m|million|trillion|tn)?\b|\d+(?:\.\d+)?\s*%|\b(?:CAGR|YoY)\b/gi;
