/**
 * Test Helper Functions
 *
 * Shared utilities for integration tests that spawn processes.
 */

import type { ChildProcess } from 'child_process';

/**
 * Safely cleanup a spawned child process with proper timeout handling.
 *
 * This function:
 * 1. Sends SIGTERM for graceful shutdown
 * 2. Waits up to gracefulTimeout for the process to exit
 * 3. Sends SIGKILL if timeout is exceeded
 * 4. Properly cleans up event listeners and timeouts
 *
 * @param process - The child process to cleanup (or null if already cleaned)
 * @param gracefulTimeout - Time to wait for graceful shutdown before force kill (ms)
 */
export async function cleanupProcess(
  process: ChildProcess | null,
  gracefulTimeout = 5000
): Promise<void> {
  if (!process || process.killed) {
    return;
  }

  process.kill('SIGTERM');

  await new Promise<void>((resolve) => {
    const exitHandler = () => {
      clearTimeout(killTimeout);
      process?.removeListener('exit', exitHandler);
      resolve();
    };

    const killTimeout = setTimeout(() => {
      process?.removeListener('exit', exitHandler);
      if (process && !process.killed) {
        console.warn(`Force killing process (PID: ${process.pid}) after ${gracefulTimeout}ms timeout`);
        process.kill('SIGKILL');
      }
      resolve();
    }, gracefulTimeout);

    process.once('exit', exitHandler);
  });
}
