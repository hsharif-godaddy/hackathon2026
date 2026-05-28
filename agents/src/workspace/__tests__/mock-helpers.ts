/**
 * Test helpers for workspace-related mocks.
 *
 * Provides factory functions for creating RunCommandResult objects with
 * sensible defaults, reducing boilerplate in unit tests.
 */

import type { RunCommandResult } from '../tasks.js';

/**
 * Create a RunCommandResult with defaults for a successful command.
 * Override any field via the partial parameter.
 *
 * @example
 * // Successful result (all defaults)
 * makeRunCommandResult()
 *
 * // Failed result with stderr
 * makeRunCommandResult({ exitCode: 1, stderr: 'not found' })
 *
 * // Timed-out result
 * makeRunCommandResult({ exitCode: -1, timedOut: true, executionTimeMs: 30_000 })
 */
export function makeRunCommandResult(overrides: Partial<RunCommandResult> = {}): RunCommandResult {
  return {
    taskId: 't',
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    executionTimeMs: 1,
    ...overrides,
  };
}
