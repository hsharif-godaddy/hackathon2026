/**
 * Poll the app's AI token spend via the token-budget API.
 *
 * Uses the same API the frontend's UsageGauge calls:
 *   1. GET /api/subscriptions → active subscription ID
 *   2. GET /api/token-budget/{subscriptionId} → { spend, maxBudget, percentage }
 */

type BrowserPage = {
  url(): string;
  evaluate<T>(fn: string | ((...args: unknown[]) => T | Promise<T>), ...args: unknown[]): Promise<T>;
};

export interface AppUsageResult {
  subscriptionId: string;
  spend: number;
  maxBudget: number;
  percentage: number;
  resetTime: string | null;
}

interface BrowserResult {
  subscriptionId?: string;
  spend?: number;
  maxBudget?: number;
  percentage?: number;
  resetTime?: string | null;
  error?: string;
}

/**
 * Fetch the app's current token spend from the mgmt-airo token-budget API.
 * Runs in the browser context using the authenticated session.
 */
export async function fetchAppUsage(page: BrowserPage): Promise<AppUsageResult | null> {
  try {
    const result: BrowserResult = await page.evaluate(async () => {
      try {
        // Step 1: Get active subscription ID
        const subResponse = await fetch('/api/subscriptions', { credentials: 'include' });
        if (!subResponse.ok) {
          return { error: `Failed to fetch subscriptions: ${subResponse.status}` };
        }
        const subData = await subResponse.json();
        const subscriptionId = subData?.data?.active?.id;
        if (!subscriptionId) {
          return { error: 'No active subscription found' };
        }

        // Step 2: Get token budget (spend + limits)
        const budgetResponse = await fetch(`/api/token-budget/${encodeURIComponent(subscriptionId)}`);
        if (!budgetResponse.ok) {
          return { error: `Failed to fetch token budget: ${budgetResponse.status}` };
        }
        const budget = await budgetResponse.json();

        return {
          subscriptionId,
          spend: budget.spend ?? 0,
          maxBudget: budget.maxBudget ?? 0,
          percentage: budget.percentage ?? 0,
          resetTime: budget.resetTime ?? null,
        };
      } catch (err) {
        return { error: String(err) };
      }
    });

    if (result.error) {
      console.log('App usage fetch error: %s', result.error);
      return null;
    }

    if (result.subscriptionId === undefined || result.spend === undefined ||
        result.maxBudget === undefined || result.percentage === undefined) {
      console.log('App usage response missing required fields: %j', result);
      return null;
    }

    return {
      subscriptionId: result.subscriptionId,
      spend: result.spend,
      maxBudget: result.maxBudget,
      percentage: result.percentage,
      resetTime: result.resetTime ?? null,
    };
  } catch (error) {
    console.log('Failed to fetch app usage: %s', error);
    return null;
  }
}
