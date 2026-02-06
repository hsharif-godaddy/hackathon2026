import type { Page, APIRequestContext } from '@playwright/test';
import { DEPLOYMENT_POLL_INTERVAL_MS, DEPLOYMENT_TIMEOUT_MS } from './constants';

interface SiteInfo {
  id: string;
  name?: string;
  initial_prompt?: string;
}

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

      const sites = await response.json() as Array<{ id: string; name?: string; initial_prompt?: string }>;
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
  }

  return result.deletedCount;
}

/**
 * Delete all test sites via API using the browser's authenticated context
 */
export async function deleteAllSitesViaAPI(page: Page): Promise<number> {
  console.log('🧹 Cleaning up test sites via API...');

  const result = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/sites');
      if (!response.ok) {
        return { error: `Could not fetch sites: ${response.status}`, deletedCount: 0 };
      }

      const sites = await response.json();
      if (!Array.isArray(sites) || sites.length === 0) {
        return { message: 'No sites found to clean up', deletedCount: 0 };
      }

      let deletedCount = 0;
      const errors: string[] = [];

      for (const site of sites) {
        try {
          const deleteResponse = await fetch(`/api/sites/${site.id}`, { method: 'DELETE' });
          if (deleteResponse.ok) {
            deletedCount++;
          } else {
            errors.push(`Failed to delete ${site.id}: ${deleteResponse.status}`);
          }
        } catch (err) {
          errors.push(`Error deleting ${site.id}: ${String(err)}`);
        }
      }

      return { deletedCount, total: sites.length, errors };
    } catch (err) {
      return { error: String(err), deletedCount: 0 };
    }
  });

  if ('error' in result && result.error) {
    console.log(`⚠️ ${result.error}`);
  } else if ('message' in result && result.message) {
    console.log(`⚠️ ${result.message}`);
  } else {
    console.log(`🎯 API cleanup completed: ${result.deletedCount}/${result.total} sites deleted`);
  }

  return result.deletedCount || 0;
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
