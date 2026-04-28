import type { DevSupervisorClient, ExecResult } from './DevSupervisorClient.js';
import { DevSupervisorClientFactory } from '../utils/dev-supervisor-client-factory.js';
import { logger } from '../logging/index.js';

/**
 * A single tsc diagnostic parsed from `tsc --noEmit --pretty false`
 * output.
 */
export interface TscError {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
}

/**
 * Outcome of a post-hook type check.
 *
 * - `ok=true, errors=[]` — clean run, nothing to do.
 * - `ok=false, errors=[...]` — real type errors the agent should fix.
 * - `ok=true, skipped=true, reason` — the check couldn't run (timeout,
 *   no supervisor, preview stopped, etc.). Callers should treat this
 *   as "do not block the message" and simply continue — never convert
 *   a skip into a fake pass/fail.
 */
export interface TypecheckResult {
  ok: boolean;
  errors: TscError[];
  /** True when the check didn't meaningfully run (see `reason`). */
  skipped?: boolean;
  reason?: 'no_supervisor' | 'preview_stopped' | 'timeout' | 'exec_failure' | 'aborted';
  /** ms spent inside the tsc exec (wall time from the container). */
  durationMs?: number;
}

/**
 * Matches tsc --pretty=false error lines:
 *   src/foo.ts(12,3): error TS2322: Type 'string' is not assignable to type 'number'.
 */
const ERROR_RE = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/;

/**
 * Seconds. Defense-in-depth wall clock for the exec call. Practical tsc runs
 * on a generated Vite/React app take 2–6s; 30s covers cold caches + a big
 * app without stranding the user if the container wedges.
 */
const DEFAULT_TIMEOUT_SEC = 30;

/**
 * Case-insensitive substrings that, if present in an exec error message,
 * mean the preview container isn't actually running (start-on-request mode,
 * crashed, or still spinning up). We treat them as `skipped: preview_stopped`
 * so the message can still finalize — burning an LLM turn to spin up a
 * preview nobody is looking at is worse than occasionally missing a check.
 *
 * The `dev-supervisor ...` strings match the wrapped errors produced by
 * `DevSupervisorClient.makeRequest` when the socket/TCP endpoint can't be
 * reached; `connection refused` / `econnrefused` / `enoent` / `enotfound`
 * cover the raw Node networking errors that can leak through for TCP mode.
 */
const PREVIEW_STOPPED_HINTS = [
  'econnrefused',
  'enoent',
  'enotfound',
  'dev-supervisor not available',
  'connection refused',
  'not running',
  'container stopped'
];

/**
 * Parse stdout/stderr from `tsc --noEmit --pretty false` into structured errors.
 * tsc routinely splits diagnostics across both streams depending on version and
 * terminal type, so we scan both and dedupe by the (file, line, column, code)
 * key to avoid double-reporting when a diagnostic appears in both.
 */
export function parseTscOutput(stdout: string, stderr: string): TscError[] {
  const combined = `${stdout}\n${stderr}`;
  const seen = new Set<string>();
  const errors: TscError[] = [];

  for (const rawLine of combined.split('\n')) {
    const line = rawLine.trimEnd();
    const match = line.match(ERROR_RE);
    if (!match) continue;
    const [, file, lineStr, colStr, code, message] = match;
    if (!file || !lineStr || !colStr || !code || !message) continue;

    const key = `${file}:${lineStr}:${colStr}:${code}`;
    if (seen.has(key)) continue;
    seen.add(key);

    errors.push({
      file,
      line: parseInt(lineStr, 10),
      column: parseInt(colStr, 10),
      code,
      message
    });
  }

  return errors;
}

/**
 * Classify an exec error. Returns the skip reason if we should treat it as a
 * soft-skip rather than a hard failure.
 */
function classifyExecError(err: unknown): TypecheckResult['reason'] {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  for (const hint of PREVIEW_STOPPED_HINTS) {
    if (msg.includes(hint)) return 'preview_stopped';
  }
  return 'exec_failure';
}

/**
 * Post-hook TypeScript checker.
 *
 * Runs `npx tsc --noEmit --pretty false` inside the preview container via
 * dev-supervisor `/exec`. The preview container bind-mounts the generated
 * app at `/app`, so this executes against the exact files the user will
 * see in the iframe — not a stale copy in the agent container.
 *
 * This service is deliberately stateless and dependency-free beyond
 * DevSupervisorClientFactory so it can be injected into tests without a
 * full service-container setup.
 */
export class TypecheckService {
  /**
   * Run a type check for an app.
   *
   * Behavioural contract worth preserving:
   * - Never throws on recoverable problems. Callers bail by checking
   *   `skipped`, not by wrapping in try/catch.
   * - Always returns quickly on `AbortSignal.abort()` without waiting for
   *   the in-flight exec to finish (the exec itself will be cancelled by
   *   the dev-supervisor timeout separately).
   */
  async runTypecheck(
    appId: string,
    options?: { timeoutSec?: number; signal?: AbortSignal }
  ): Promise<TypecheckResult> {
    const timeoutSec = options?.timeoutSec ?? DEFAULT_TIMEOUT_SEC;

    if (options?.signal?.aborted) {
      return { ok: true, errors: [], skipped: true, reason: 'aborted' };
    }

    let devSupervisor: DevSupervisorClient | null;
    try {
      devSupervisor = DevSupervisorClientFactory.createForApp(appId);
    } catch (err) {
      logger.warn('agent.typecheck.skipped', {
        appId,
        reason: 'no_supervisor',
        error: err instanceof Error ? err.message : String(err)
      });
      return { ok: true, errors: [], skipped: true, reason: 'no_supervisor' };
    }

    if (!devSupervisor) {
      logger.info('agent.typecheck.skipped', { appId, reason: 'no_supervisor' });
      return { ok: true, errors: [], skipped: true, reason: 'no_supervisor' };
    }

    // Run the exec and an abort race so a user-stop in the middle of a long
    // check doesn't strand us waiting for dev-supervisor's full timeout+5s.
    let execResult: ExecResult;
    const begin = Date.now();
    try {
      execResult = await this.execWithAbort(
        devSupervisor,
        {
          command: 'npx tsc --noEmit --pretty false',
          working_dir: '/app',
          timeout: timeoutSec
        },
        options?.signal
      );
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        logger.info('agent.typecheck.skipped', { appId, reason: 'aborted' });
        return { ok: true, errors: [], skipped: true, reason: 'aborted' };
      }
      const reason = classifyExecError(err);
      logger.warn('agent.typecheck.skipped', {
        appId,
        reason,
        error: err instanceof Error ? err.message : String(err)
      });
      return { ok: true, errors: [], skipped: true, reason };
    }
    const durationMs = Date.now() - begin;

    if (execResult.timed_out) {
      logger.warn('agent.typecheck.skipped', {
        appId,
        reason: 'timeout',
        durationMs,
        timeoutSec
      });
      return { ok: true, errors: [], skipped: true, reason: 'timeout', durationMs };
    }

    // tsc exits 0 on success, non-zero on errors or internal crashes. We only
    // trust the non-zero branch to contain parseable diagnostics — otherwise
    // we'd convert a true clean run into a fake "0 errors" loop on the agent.
    if (execResult.exit_code === 0) {
      return { ok: true, errors: [], durationMs };
    }

    const errors = parseTscOutput(execResult.stdout, execResult.stderr);

    // exit_code != 0 but nothing matched the error regex: tsc itself crashed
    // (stack trace, out-of-memory, etc). Don't block the user with a retry
    // loop on something the agent can't actually fix.
    if (errors.length === 0) {
      logger.warn('agent.typecheck.skipped', {
        appId,
        reason: 'exec_failure',
        exitCode: execResult.exit_code,
        stdoutPreview: execResult.stdout.slice(0, 500),
        stderrPreview: execResult.stderr.slice(0, 500),
        durationMs
      });
      return { ok: true, errors: [], skipped: true, reason: 'exec_failure', durationMs };
    }

    return { ok: false, errors, durationMs };
  }

  /**
   * Promise.race a normal `exec` against an abort signal so that aborts
   * return promptly even when dev-supervisor hasn't yet honoured its
   * internal timeout. The abandoned exec promise drains in the background —
   * dev-supervisor's own timeout (passed through `ExecOptions.timeout`)
   * makes sure its side of the socket eventually releases.
   */
  private async execWithAbort(
    client: DevSupervisorClient,
    options: { command: string; working_dir: string; timeout: number },
    signal: AbortSignal | undefined
  ): Promise<ExecResult> {
    const execPromise = client.exec(options);
    if (!signal) return execPromise;

    return await new Promise<ExecResult>((resolve, reject) => {
      const onAbort = () => {
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        reject(abortErr);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      execPromise.then(
        (result) => {
          signal.removeEventListener('abort', onAbort);
          resolve(result);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        }
      );
    });
  }
}

