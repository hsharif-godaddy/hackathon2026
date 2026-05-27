/**
 * Writes a warning to stderr, clearing the current progress-bar line first
 * when running in a TTY. In non-TTY environments (CI, piped output) the
 * escape sequence is skipped so output stays clean.
 *
 * Never throws: a broken stderr pipe degrades to uncleared output, not a crash.
 */
export function warnLine(message: string, data?: Record<string, unknown>): void {
  if (process.stderr.isTTY) {
    try {
      process.stderr.write('\r\x1B[K');
    } catch {
      // broken pipe or closed stream — degrade gracefully
    }
  }

  if (data !== undefined) {
    console.warn(message, data);
  } else {
    console.warn(message);
  }
}
