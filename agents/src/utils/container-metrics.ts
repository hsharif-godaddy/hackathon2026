/**
 * Container metrics utilities
 *
 * Provides helper functions for collecting container metrics via workspace tasks
 * (runCommandSync executed inside the preview container by dev-supervisor).
 */

import type { WorkspaceTasks } from '../workspace/tasks.js';

/**
 * Measure the total size of /app directory including all subdirectories.
 * Best-effort: returns undefined on any error (never throws).
 *
 * @param tasks - Workspace tasks for executing commands in container
 * @returns Size in bytes, or undefined if measurement fails
 */
export async function measureAppDirSize(tasks: Pick<WorkspaceTasks, 'runCommandSync'>): Promise<number | undefined> {
  try {
    const result = await tasks.runCommandSync({
      command: 'du -sb ${CUSTOMER_APP_DIR:-/app} 2>/dev/null | cut -f1',
      timeoutSeconds: 30,
    });
    if (result.stdout) {
      const sizeBytes = parseInt(result.stdout.trim(), 10);
      if (!isNaN(sizeBytes)) {
        return sizeBytes;
      }
    }
  } catch {
    // Ignore errors - this is best-effort metrics collection
  }
  return undefined;
}

/**
 * Convert bytes to megabytes with 2 decimal precision.
 * Returns -1 if bytes is null/undefined (sentinel for ES aggregation).
 *
 * @param bytes - Size in bytes (can be null/undefined)
 * @returns Size in MB rounded to 2 decimals, or -1 if unavailable
 */
export function bytesToMB(bytes: number | undefined | null): number {
  if (bytes == null) {
    return -1;
  }
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}
