/**
 * Poll the app's credit usage via the credit grants API.
 *
 * Uses the same API the frontend's UsageGauge calls:
 *   1. GET /api/subscriptions → active subscription ID
 *   2. GET /api/credits/grants?subscriptionId=...&syncSpend=true
 *      → { success: boolean; data: CreditGrant[] }
 *
 * Only available (isAvailable === true) grants are aggregated.
 */

type BrowserPage = {
  url(): string;
  evaluate<T>(fn: string | ((...args: unknown[]) => T | Promise<T>), ...args: unknown[]): Promise<T>;
};

export interface AppUsageResult {
  subscriptionId: string;
  creditsSpent: number;
  creditsMax: number;
  percentage: number;
}

interface BrowserResult {
  subscriptionId?: string;
  creditsSpent?: number;
  creditsMax?: number;
  percentage?: number;
  error?: string;
}

/**
 * Fetch the app's current credit usage from the credit grants API.
 * Runs in the browser context using the authenticated session.
 *
 * @param syncSpend - When true, triggers a backend spend sync before returning.
 *   Pass true for the initial call and false for retry/poll calls to avoid
 *   redundant backend work.
 */
export async function fetchAppUsage(page: BrowserPage, syncSpend = true): Promise<AppUsageResult | null> {
  try {
    const result: BrowserResult = await page.evaluate(async (sync: unknown) => {
      try {
        const subResponse = await fetch('/api/subscriptions', { credentials: 'include' });
        if (!subResponse.ok) {
          return { error: `Failed to fetch subscriptions: ${subResponse.status}` };
        }
        const subData = await subResponse.json();
        const subscriptionId = subData?.data?.active?.id;
        if (!subscriptionId) {
          return { error: 'No active subscription found' };
        }

        const params = new URLSearchParams({
          subscriptionId,
          syncSpend: String(Boolean(sync)),
        });
        const grantsResponse = await fetch(`/api/credits/grants?${params.toString()}`, {
          credentials: 'include',
        });
        if (!grantsResponse.ok) {
          return { error: `Failed to fetch credit grants: ${grantsResponse.status}` };
        }
        const grantsData = await grantsResponse.json();

        if (!grantsData.success || !Array.isArray(grantsData.data)) {
          return { error: 'Unexpected credit grants response format' };
        }

        const grants: Array<{ creditsSpent: number; creditsMax: number; isAvailable: boolean }> = grantsData.data;
        let totalSpent = 0;
        let totalMax = 0;
        for (const grant of grants.filter(g => g.isAvailable)) {
          const max = grant.creditsMax ?? 0;
          totalSpent += Math.min(grant.creditsSpent ?? 0, max);
          totalMax += max;
        }

        return {
          subscriptionId,
          creditsSpent: totalSpent,
          creditsMax: totalMax,
          percentage: totalMax > 0 ? Math.round((totalSpent / totalMax) * 100) : 0,
        };
      } catch (err) {
        return { error: String(err) };
      }
    }, syncSpend);

    if (result.error) {
      console.log('App usage fetch error: %s', result.error);
      return null;
    }

    if (result.subscriptionId === undefined || result.creditsSpent === undefined ||
        result.creditsMax === undefined || result.percentage === undefined) {
      console.log('App usage response missing required fields: %j', result);
      return null;
    }

    return {
      subscriptionId: result.subscriptionId,
      creditsSpent: result.creditsSpent,
      creditsMax: result.creditsMax,
      percentage: result.percentage,
    };
  } catch (error) {
    console.log('Failed to fetch app usage: %s', error);
    return null;
  }
}
