import type { Page, APIRequestContext } from '@playwright/test';
import { DEPLOYMENT_POLL_INTERVAL_MS, DEPLOYMENT_TIMEOUT_MS, MAX_TEST_APPS, TEST_APP_BUFFER } from './constants';

interface SiteInfo {
  id: string;
  name?: string;
  initial_prompt?: string;
  /** ISO8601 timestamp from GET /api/sites — used to find the oldest apps for eviction. */
  created_at?: string;
}

/**
 * Substring that every test-created app's `name` or `initial_prompt` carries
 * via `getSpecPrefix(...)` in `tests/helpers/constants.ts` — always
 * `[e2e:<spec>:<salt>]`. Used by the eviction guard to identify test-owned
 * apps so we never touch non-test apps in the same account.
 */
const E2E_PREFIX_MARKER = '[e2e:';

interface DeploymentPollResult {
  success: boolean;
  deploymentId: string;
  status: string;
}

/**
 * Get an existing app ID from the API or create one if none exist
 */
export async function getExistingAppId(page: Page): Promise<string | null> {
  const response = await page.evaluate(async () => {
    const res = await fetch('/api/sites');
    if (!res.ok) return null;
    const sites = await res.json();
    return sites.length > 0 ? sites[0].id : null;
  });

  return response;
}

/**
 * Delete an app by ID via the API
 */
export async function deleteApp(page: Page, appId: string): Promise<boolean> {
  if (!appId) return false;

  const result = await page.evaluate(async (id) => {
    const response = await fetch(`/api/sites/${id}`, { method: 'DELETE' });
    if (response.ok) {
      const data = await response.json();
      return data.success === true;
    }
    return false;
  }, appId);

  if (result) {
    console.log(`✓ Deleted app: ${appId}`);
  } else {
    console.log(`⚠ Could not delete app: ${appId}`);
  }

  return result;
}

/**
 * Delete all apps matching a prefix
 */
export async function deleteAppsWithPrefix(page: Page, prefix: string): Promise<number> {
  const result = await page.evaluate(async (prefixValue) => {
    try {
      const response = await fetch('/api/sites');
      if (!response.ok) return { deletedCount: 0, error: `API error: ${response.status}` };

      const sites = await response.json() as SiteInfo[];
      if (!Array.isArray(sites) || sites.length === 0) return { deletedCount: 0 };

      const toDelete = sites.filter((site) => {
        const searchFields = [site.name, site.initial_prompt].filter(Boolean).join(' ');
        return searchFields.includes(prefixValue);
      });

      let deletedCount = 0;
      for (const site of toDelete) {
        const deleteResponse = await fetch(`/api/sites/${site.id}`, { method: 'DELETE' });
        if (deleteResponse.ok) {
          deletedCount++;
        }
      }

      return { deletedCount };
    } catch (err) {
      return { deletedCount: 0, error: String(err) };
    }
  }, prefix);

  if (result.error) {
    console.log(`Could not delete apps with prefix '${prefix}': ${result.error}`);
  } else if (result.deletedCount > 0) {
    console.log(`Deleted ${result.deletedCount} app(s) with prefix: ${prefix}`);
  } else {
    // Log the zero case so a mistyped SPEC_PREFIXES entry is distinguishable
    // from "cleanup ran and matched nothing" when investigating orphans.
    console.log(`No apps matched prefix: ${prefix}`);
  }

  return result.deletedCount;
}

/**
 * Pre-flight guard for the mgmt-airo "Maximum N apps per system" cap. If the
 * test account has accumulated e2e-tagged apps close to that hard cap, evict
 * the oldest e2e apps so this run has room to create new ones. Compensates
 * for prior cleanup failures (test crashes, network blips in afterEach) that
 * leave orphans behind across runs — without this, accumulated orphans
 * eventually trip APP_LIMIT_EXCEEDED and break every future run.
 *
 * Only apps whose `name` or `initial_prompt` contains `[e2e:` are eligible —
 * non-test apps in the account are never touched. Sorted by `created_at`
 * ascending so the oldest go first.
 *
 * Trigger: total sites visible to this JWT >= (MAX_TEST_APPS - TEST_APP_BUFFER).
 * On trigger we delete enough oldest e2e apps to land at threshold - 1.
 *
 * No-op (returns 0) when below the threshold or when the GET fails — better
 * to let the test surface the real auth/network error than swallow it here.
 */
export async function evictOldestE2eAppsToFitLimit(
  page: Page,
  opts: { threshold?: number } = {},
): Promise<number> {
  const threshold = opts.threshold ?? (MAX_TEST_APPS - TEST_APP_BUFFER);

  const result = await page.evaluate(async ({ thresholdValue, marker }) => {
    try {
      const response = await fetch('/api/sites');
      if (!response.ok) {
        return { evicted: 0, fetchError: `GET /api/sites returned ${response.status}` };
      }
      const sites = await response.json() as SiteInfo[];
      if (!Array.isArray(sites)) {
        return { evicted: 0, fetchError: 'GET /api/sites did not return an array' };
      }

      const total = sites.length;
      if (total < thresholdValue) {
        return { evicted: 0, total, e2eCount: 0, skipped: true };
      }

      const e2eApps = sites.filter((site) => {
        const haystack = [site.name, site.initial_prompt].filter(Boolean).join(' ');
        return haystack.includes(marker);
      });

      // Oldest first. Sites without `created_at` (or with malformed timestamps
      // that Date.parse returns NaN for) sort to the end as "newest unknown",
      // so we don't accidentally evict apps with broken timestamps before
      // known-old ones. Without the NaN guard the comparator returns NaN
      // and Array.sort treats it as 0 — broken-timestamp apps end up in
      // random positions instead of at the end.
      e2eApps.sort((a, b) => {
        const parseOrInf = (s: string | undefined): number => {
          if (!s) return Number.POSITIVE_INFINITY;
          const t = Date.parse(s);
          return isNaN(t) ? Number.POSITIVE_INFINITY : t;
        };
        return parseOrInf(a.created_at) - parseOrInf(b.created_at);
      });

      // Land at `threshold - 1` so the create call after this guard has room.
      const evictTarget = total - thresholdValue + 1;
      const toEvict = e2eApps.slice(0, evictTarget);

      let evicted = 0;
      const errors: string[] = [];
      for (const site of toEvict) {
        const deleteResponse = await fetch(`/api/sites/${site.id}`, { method: 'DELETE' });
        if (deleteResponse.ok) {
          evicted++;
        } else {
          errors.push(`${site.id}: ${deleteResponse.status}`);
        }
      }

      return {
        evicted,
        total,
        e2eCount: e2eApps.length,
        wanted: evictTarget,
        errors,
      };
    } catch (err) {
      return { evicted: 0, fetchError: String(err) };
    }
  }, { thresholdValue: threshold, marker: E2E_PREFIX_MARKER });

  if ('fetchError' in result && result.fetchError) {
    console.log(`⚠️ App-limit guard skipped: ${result.fetchError}`);
    return 0;
  }
  if ('skipped' in result && result.skipped) {
    return 0;
  }
  const { evicted = 0, total = 0, e2eCount = 0, wanted = 0, errors = [] } = result;
  if (evicted < wanted) {
    console.log(
      `⚠️ App-limit guard: evicted ${evicted}/${wanted} oldest e2e apps ` +
      `(total=${total}, e2eCount=${e2eCount}, threshold=${threshold}). ` +
      `Test may still hit APP_LIMIT_EXCEEDED.` +
      (errors.length > 0 ? ` Delete errors: ${errors.join('; ')}` : ''),
    );
  } else {
    console.log(
      `🧹 App-limit guard: evicted ${evicted} oldest e2e app(s) ` +
      `(total=${total}, e2eCount=${e2eCount}, threshold=${threshold})`,
    );
  }
  return evicted;
}

/** Terminal deployment statuses that should stop polling */
const TERMINAL_STATUSES = ['deployed', 'failed', 'error', 'cancelled', 'canceled'];

/**
 * Poll deployment status until complete or timeout
 * Handles all terminal statuses to avoid infinite loops
 */
export async function pollDeploymentStatus(
  page: Page,
  appId: string,
  deploymentId: string,
  pollInterval = DEPLOYMENT_POLL_INTERVAL_MS,
  maxWaitTime = DEPLOYMENT_TIMEOUT_MS
): Promise<DeploymentPollResult> {
  const startTime = Date.now();

  while (true) {
    const elapsed = Date.now() - startTime;

    if (elapsed >= maxWaitTime) {
      console.log(`Deployment timeout after ${Math.round(elapsed / 1000)}s`);
      return { success: false, deploymentId, status: 'timeout' };
    }

    const result = await page.evaluate(async ({ appId: id, deploymentId: depId }) => {
      try {
        const response = await fetch(`/api/apps/${id}/deployments?limit=10&includeJobData=true`);
        if (!response.ok) {
          return { status: 'error', message: `API error: ${response.status}` };
        }

        const data = await response.json();
        const deployments = data.deployments || data || [];
        const deployment = deployments.find((d: { id: string }) => d.id === depId);

        if (!deployment) {
          return { status: 'not_found' };
        }

        return { status: deployment.status?.toLowerCase() || 'unknown' };
      } catch (err) {
        return { status: 'error', message: String(err) };
      }
    }, { appId, deploymentId });

    console.log(`Deployment status: ${result.status} (elapsed: ${Math.round(elapsed / 1000)}s)`);

    // Check for successful deployment
    if (result.status === 'deployed') {
      console.log(`Deployment successful after ${Math.round(elapsed / 1000)}s`);
      return { success: true, deploymentId, status: 'deployed' };
    }

    // Check for any terminal failure status
    if (TERMINAL_STATUSES.includes(result.status) && result.status !== 'deployed') {
      console.log(`Deployment ended with status '${result.status}' after ${Math.round(elapsed / 1000)}s`);
      return { success: false, deploymentId, status: result.status };
    }

    // For unknown statuses, log a warning but continue polling (up to timeout)
    if (!['pending', 'queued', 'running', 'in_progress', 'not_found'].includes(result.status)) {
      console.log(`Unknown deployment status '${result.status}', continuing to poll...`);
    }

    // Continue polling
    await page.waitForTimeout(pollInterval);
  }
}

/**
 * Clean up apps created by a specific spec
 */
export async function cleanupSpecApps(page: Page, specPrefix: string): Promise<void> {
  console.log(`🧹 Cleaning up apps with prefix: ${specPrefix}`);
  await deleteAppsWithPrefix(page, specPrefix);
}
