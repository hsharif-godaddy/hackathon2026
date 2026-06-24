import { AppRepository } from '../../database/repositories/AppRepository.js';
import { logger } from '../../logging/index.js';
import { GitUtils } from '../../utils/git.js';
import { createForWorkspace } from '../../workspace/index.js';
import { PUBLISH_RECONCILE_POLL_TIMEOUT_MS } from './publish-timeouts.js';

const HEALTH_POLL_INTERVAL_MS = 3000;

export type PublishTimeoutReconcileResult =
  | { verified: true; commitHash: string }
  | { verified: false; reason: string };

export function isPublishTimeoutError(error: string): boolean {
  const lower = error.toLowerCase();
  return lower.includes('timeout') || lower.includes('timed out');
}

export function commitsMatch(expected: string, actual: string | null | undefined): boolean {
  if (!actual) {
    return false;
  }
  const normalizedExpected = expected.trim().toLowerCase();
  const normalizedActual = actual.trim().toLowerCase();
  if (normalizedExpected === normalizedActual) {
    return true;
  }
  if (normalizedExpected.length >= 7 && normalizedActual.startsWith(normalizedExpected)) {
    return true;
  }
  if (normalizedActual.length >= 7 && normalizedExpected.startsWith(normalizedActual)) {
    return true;
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>(function wait(resolve) {
    setTimeout(resolve, ms);
  });
}

async function resolveExpectedCommit(
  appId: string,
  commitHash?: string
): Promise<string | undefined> {
  if (commitHash) {
    return commitHash;
  }
  const app = new AppRepository().findById(appId);
  if (!app?.path) {
    return undefined;
  }
  const workspace = createForWorkspace(appId, 'preview');
  if (!workspace) {
    return undefined;
  }
  try {
    return await new GitUtils(workspace.tasks).getCurrentCommit(app.path);
  } catch (err) {
    logger.warn('skill.publishing.publish.timeout_reconcile.commit_resolve_failed', {
      appId,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/**
 * When the publish client action times out, poll production deployment status
 * to see whether the deploy actually landed before telling the agent it failed.
 */
export async function reconcilePublishAfterTimeout(options: {
  appId: string;
  expectedCommitHash?: string;
  pollTimeoutMs?: number;
}): Promise<PublishTimeoutReconcileResult> {
  const { appId, expectedCommitHash, pollTimeoutMs = PUBLISH_RECONCILE_POLL_TIMEOUT_MS } = options;
  const workspace = createForWorkspace(appId, 'publish');
  if (!workspace) {
    return { verified: false, reason: 'Publish supervisor unavailable' };
  }

  const expectedCommit = await resolveExpectedCommit(appId, expectedCommitHash);
  if (!expectedCommit) {
    return { verified: false, reason: 'Could not determine expected commit hash' };
  }

  const deadline = Date.now() + pollTimeoutMs;
  logger.info('skill.publishing.publish.timeout_reconcile.begin', {
    appId,
    expectedCommit: expectedCommit.substring(0, 7),
    pollTimeoutMs,
  });

  while (Date.now() < deadline) {
    try {
      const status = await workspace.deployments.status({ includeLogs: false, logLines: 0 });

      if (status.process.state === 'error') {
        return {
          verified: false,
          reason: status.health.message || 'Production process is in error state',
        };
      }

      if (status.health.status === 'healthy' && commitsMatch(expectedCommit, status.version)) {
        logger.info('skill.publishing.publish.timeout_reconcile.success', {
          appId,
          version: status.version?.substring(0, 7),
        });
        return { verified: true, commitHash: status.version! };
      }
    } catch (err) {
      logger.warn('skill.publishing.publish.timeout_reconcile.poll_error', {
        appId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await sleep(HEALTH_POLL_INTERVAL_MS);
  }

  logger.warn('skill.publishing.publish.timeout_reconcile.failed', { appId });
  return {
    verified: false,
    reason: 'Production did not become healthy with the expected commit before reconciliation timed out',
  };
}
