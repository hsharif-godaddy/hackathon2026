/**
 * Read a positive-integer env var.
 * Returns {@link fallback} when the var is unset, empty, non-numeric,
 * or less than 1.
 */
function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

/**
 * Read MAX_CONCURRENCY (max concurrent trials) from the environment.
 * Returns {@link fallback} when unset, empty, non-numeric, or < 1.
 */
export function parseMaxConcurrency(fallback: number): number {
  return parsePositiveIntEnv('MAX_CONCURRENCY', fallback);
}

/**
 * Read MAX_TURNS (max turns per simulation) from the environment.
 * Returns {@link fallback} when unset, empty, non-numeric, or < 1.
 */
export function parseMaxTurns(fallback: number): number {
  return parsePositiveIntEnv('MAX_TURNS', fallback);
}

/**
 * Read TURN_TIMEOUT_MS (per-turn hard timeout) from the environment.
 * Heavy first-build scenarios (e.g. a design-system homepage build) can exceed
 * the default cap; raise it via this var without changing the default for every
 * other scenario. Returns {@link fallback} when unset, empty, non-numeric, or < 1.
 */
export function parseTurnTimeoutMs(fallback: number): number {
  return parsePositiveIntEnv('TURN_TIMEOUT_MS', fallback);
}

/**
 * Read CAPTURE_CONCURRENCY (max concurrent Playwright captures) from the
 * environment. This bounds the expensive capture phase independently of
 * trial concurrency. Returns {@link fallback} when unset, empty,
 * non-numeric, or < 1.
 */
export function parseCaptureConcurrency(fallback: number): number {
  return parsePositiveIntEnv('CAPTURE_CONCURRENCY', fallback);
}

/**
 * Read MAX_CAPTURE_CONCURRENCY (hard ceiling for capture concurrency) from the
 * environment. Bounds how high CAPTURE_CONCURRENCY / --capture-concurrency can
 * push capture parallelism. Returns {@link fallback} when unset, empty,
 * non-numeric, or < 1.
 */
export function parseMaxCaptureConcurrency(fallback: number): number {
  return parsePositiveIntEnv('MAX_CAPTURE_CONCURRENCY', fallback);
}

/**
 * Read MAX_ROUTES (max routes captured per trial) from the environment.
 * Returns {@link fallback} when unset, empty, non-numeric, or < 1.
 */
export function parseMaxRoutes(fallback: number): number {
  return parsePositiveIntEnv('MAX_ROUTES', fallback);
}

/**
 * Read AGENTS_PORT (port the AAB agents server is listening on) from the
 * environment. Mirrors the agents service's own `process.env.PORT || 4000`
 * so a local override (e.g. AGENTS_PORT=4040) keeps both sides in sync.
 * Returns {@link fallback} when unset, empty, non-numeric, or < 1.
 */
export function parseAgentsPort(fallback: number): number {
  return parsePositiveIntEnv('AGENTS_PORT', fallback);
}
