/**
 * Container metrics utilities
 *
 * Provides helper functions for collecting metrics from containers via dev-supervisor.
 */

/**
 * Interface for dev-supervisor exec method (minimal interface for metrics collection)
 */
export interface DevSupervisorExec {
  exec(options: { command: string; timeout: number }): Promise<{ stdout?: string }>;
}

/**
 * Measure the total size of /app directory including all subdirectories.
 * Best-effort: returns undefined on any error (never throws).
 *
 * @param devSupervisor - Dev supervisor client with exec method
 * @returns Size in bytes, or undefined if measurement fails
 */
export async function measureAppDirSize(devSupervisor: DevSupervisorExec): Promise<number | undefined> {
  try {
    const result = await devSupervisor.exec({
      command: 'du -sb ${CUSTOMER_APP_DIR:-/app} 2>/dev/null | cut -f1',
      timeout: 30,
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
