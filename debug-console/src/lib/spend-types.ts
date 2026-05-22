import type { BudgetResponse } from '@airo/shared/budget';
import type { CreditGrant } from '@airo/shared/grants';

// ── Legacy LLM spend (ES-backed) ──────────────────────────────────────────
// Retained for non-migrated subscriptions until BMS migration is complete.
// The BMS panel below is the long-term path; delete these once /api/llm-spend
// has no remaining callers.

export interface SpendDay {
    date: string;
    spend: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    requests: number;
}

export interface GrantBreakdown {
    grantUserId: string;
    totalSpend: number;
    totalTokens: number;
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    dailySpend: SpendDay[];
}

export interface LlmSpendData {
    subscriptionId?: string;
    grantUserIds: string[];
    totalSpend: number;
    totalTokens: number;
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCacheReadTokens: number;
    totalCacheWriteTokens: number;
    grantBreakdowns: GrantBreakdown[];
    docCount: number;
    truncated?: boolean;
}

// ── BMS spend ─────────────────────────────────────────────────────────────
// Field names mirror BMS /reports/aggregate (budgetCostTotal / productCostTotal)
// so the wire shape, internal types, and test fixtures all read the same.

export interface BmsRollup {
    budgetCostTotal: number;
    productCostTotal: number;
}

export interface BmsDailyAggregate {
    /** YYYY-MM-DD UTC. */
    date: string;
    budgetCostTotal: number;
    productCostTotal: number;
}

export interface BmsCategoryAggregate {
    /** ReportLabel value, e.g. 'airo-builder:general'. */
    category: string;
    budgetCostTotal: number;
    productCostTotal: number;
}

/**
 * Response shape from GET /api/bms/spend?subscriptionId=…
 *
 * Default panel data — fast path. The 30-day daily series is loaded lazily
 * via /api/bms/spend/daily on user request, so this response only carries the
 * single-call rollup and the per-category breakdown.
 *
 * - `useBms: false` is the signal for the panel to render the legacy grants UI.
 * - `useBms: true` carries budget/grants/rollup/categoryBreakdown. Any of those
 *   can be empty / null when BMS errored mid-pipeline (the `error` field carries
 *   the message in that case).
 */
export type BmsSpendData =
    | {
          useBms: true;
          budget: BudgetResponse | null;
          grants: CreditGrant[];
          rollup: BmsRollup;
          categoryBreakdown: BmsCategoryAggregate[];
          error?: string;
      }
    | { useBms: false; reason?: string };

/** Response shape from GET /api/bms/spend/daily?subscriptionId=… */
export interface BmsDailySpendData {
    dailySpend: BmsDailyAggregate[];
    /** Set when BMS errored mid-flight; `dailySpend` may still be partially populated. */
    error?: string;
}
