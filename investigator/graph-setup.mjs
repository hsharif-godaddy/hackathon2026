// code-review-graph (CRG) wiring for the investigator Lambda.
//
// Two responsibilities, both invoked from handler.mjs before claude spawns:
//   1. writeMcpConfig — emit the stdio MCP config JSON the Claude CLI loads
//      via `--mcp-config`. This points the CLI at the python CRG server so the
//      skill can call the graph tools (semantic_search, query_graph, etc.)
//      instead of scanning files line by line.
//   2. buildCustomerGraph — build the per-app code graph at runtime from the
//      unzipped customer source. The platform graph is fetched from S3 at
//      runtime (Task 3.3, see platform-graph.mjs); the customer's own app code
//      is only available at invocation time, so its graph is built here. This
//      is SOFT-DEGRADE: if the build fails the agent still has Read/Grep + the
//      platform graph, so we never throw.
//
// Pinned by the Task 0.1 spike (docs/superpowers/notes/2026-06-02-
// investigate-pydeps-mcp-spike.md) and CONFIRMED against the package's real CLI
// (`code-review-graph --help` / `build --help` / `serve --help` inspected in
// the built image):
//   - The stdio server launches via the package CLI's `serve` subcommand:
//     `python3.11 -m code_review_graph serve` (stdio is the default).
//   - The build subcommand is `python3.11 -m code_review_graph build --repo
//     <ROOT> --skip-flows`. The flag is `--repo` (NOT `--repo-root`); there is
//     NO `--postprocess minimal`. `--skip-flows` is the fast/"minimal" build
//     (signatures + FTS only), which keeps FTS for search.
//   - python is `python3.11` (the base's default python3 is a stripped 3.9).
//   - `LD_LIBRARY_PATH=/usr/lib64` is REQUIRED at runtime so python's `ssl`
//     import resolves against AL2023 OpenSSL instead of Node's bundled
//     libcrypto in /var/lang/lib (which lacks COMP_get_type@OPENSSL_3.0.0).
//   - PYTHONPATH=/opt/py-packages is where the pydeps are installed.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// --- Single-source constants (build + serve flags CONFIRMED via package CLI) -

// The python interpreter to use. The Lambda base's default `python3` is a
// stripped 3.9; we install python3.11 in the Dockerfile (spike Task 0.1).
export const CRG_MCP_COMMAND = 'python3.11';

// stdio MCP server launch args. CONFIRMED against the package CLI: `serve` is
// the stdio entrypoint (NOT the non-existent `code_review_graph.mcp` module).
export const CRG_MCP_ARGS = ['-m', 'code_review_graph', 'serve'];

// Build subcommand args for the runtime customer-graph build.
//
// CONFIRMED against the package's real CLI (`build --help` in the built image):
// the subcommand is `build`, the repo flag is `--repo <ROOT>` (NOT
// `--repo-root`), and the fast/"minimal" build is `--skip-flows` (signatures +
// FTS only — there is NO `--postprocess minimal`). `--skip-flows` keeps the FTS
// index so semantic/keyword search still works. The `--repo <dir>` pair is
// appended by buildCustomerGraph at call time.
export const CRG_BUILD_ARGS = [
  '-m',
  'code_review_graph',
  'build',
  '--skip-flows',
];

export const PY_PACKAGES = '/opt/py-packages';
const LD_LIBRARY_PATH = '/usr/lib64';

// Bound the runtime build so a pathological repo can't eat the whole 14-min
// Lambda budget. The build is best-effort context enrichment, not on the
// critical path — if it can't finish in 4 minutes we proceed without it.
const BUILD_TIMEOUT_MS = 4 * 60_000;

// Env the python CRG process needs to import + run. Shared by the MCP server
// config (writeMcpConfig) and the runtime build (buildCustomerGraph) so the
// two never drift. See the spike note above for why LD_LIBRARY_PATH matters.
//
// CRG_SERIAL_PARSE=1 is REQUIRED on Lambda. CRG parses files in a
// `ProcessPoolExecutor` by default, which constructs a `multiprocessing`
// semaphore (`_multiprocessing.SemLock`). Lambda containers ship no
// writable `/dev/shm`, so the semaphore creation fails with
// `FileNotFoundError: [Errno 2] No such file or directory` and the whole
// build exits 1. Forcing serial parse skips the pool entirely (single
// process, no SemLock) — the only viable mode in this sandbox. Note:
// CRG_PARSE_WORKERS=1 does NOT help — it still builds the pool. Serial is
// slower but Lambda is CPU-bound and the customer graph is best-effort.
// The CRG-specific env overrides. Kept MINIMAL on purpose: this is written
// verbatim into the stdio MCP config JSON on disk (writeMcpConfig), so it must
// NOT contain secrets — only the python import/runtime knobs. The build spawn
// (buildCustomerGraph) merges this over process.env separately, where PATH/
// HOME/LANG are actually needed.
function crgEnv() {
  return { PYTHONPATH: PY_PACKAGES, LD_LIBRARY_PATH, CRG_SERIAL_PARSE: '1' };
}

// Only the OS/runtime vars python3.11 actually needs, so the CRG child never
// inherits in-memory secrets (LOKI_API_KEY / *_ES_API_KEY / ANTHROPIC_AUTH_TOKEN
// live on process.env during a run). Nothing is written to disk, but a scoped
// env is tighter than spreading all of process.env.
const SAFE_SPAWN_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM'];
function buildGraphSpawnEnv() {
  const base = {};
  for (const key of SAFE_SPAWN_ENV_KEYS) {
    if (process.env[key] !== undefined) base[key] = process.env[key];
  }
  // CRG overrides last so PYTHONPATH/LD_LIBRARY_PATH/CRG_SERIAL_PARSE win.
  return { ...base, ...crgEnv() };
}

/**
 * Whether the CRG python tooling is actually present in the image.
 *
 * A multi-stage build WITHOUT the python deps (or a stripped image) would have
 * no /opt/py-packages/code_review_graph, in which case the Claude CLI must NOT
 * be handed an `--mcp-config` pointing at a server it can't start (that surfaces
 * as a noisy MCP connection failure in the run). The handler gates writeMcpConfig
 * + `--mcp-config` on this check so a missing/failed graph never breaks an
 * investigation — the agent just falls back to Read/Grep + the log skill.
 *
 * @param {{ root?: string }} [opts] injectable package root for tests
 * @returns {Promise<boolean>} true when the CRG package dir is importable
 */
export async function isGraphAvailable(opts = {}) {
  const root = opts.root || PY_PACKAGES;
  const { promises: fs } = await import('node:fs');
  const pathMod = await import('node:path');
  try {
    await fs.access(pathMod.join(root, 'code_review_graph'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the stdio MCP config JSON the Claude CLI loads via `--mcp-config`.
 * Always safe to call: the platform graph is always present in the image, so
 * the MCP server is useful even when the customer-graph build is skipped or
 * fails.
 *
 * @param {string} outPath absolute path to write the config to
 * @returns {Promise<string>} the path written (= outPath)
 */
export async function writeMcpConfig(outPath) {
  const { promises: fs } = await import('node:fs');
  const config = {
    mcpServers: {
      crg: {
        command: CRG_MCP_COMMAND,
        args: CRG_MCP_ARGS,
        env: crgEnv(),
      },
    },
  };
  await fs.writeFile(outPath, JSON.stringify(config, null, 2));
  return outPath;
}

/**
 * Compact, log-safe failure detail from an execFile rejection.
 *
 * execFile errors carry .code (exit code), .signal/.killed (timeout), and
 * captured .stderr/.stdout. We surface a one-line summary so a soft-failed
 * build is DIAGNOSABLE from the logs + the investigation.warning event instead
 * of vanishing into a bare catch. Stderr is tail-truncated to keep the log line
 * bounded.
 *
 * @param {unknown} err the rejection from execFileAsync
 * @returns {string} a single-line failure detail
 */
function buildFailureDetail(err) {
  const e = /** @type {{ message?: string; code?: number | string; signal?: string; killed?: boolean; stderr?: string }} */ (
    err || {}
  );
  const parts = [];
  if (e.killed || e.signal === 'SIGTERM') {
    parts.push(`timeout after ${Math.round(BUILD_TIMEOUT_MS / 1000)}s`);
  }
  if (e.code !== undefined && e.code !== null) parts.push(`exit=${e.code}`);
  if (e.signal) parts.push(`signal=${e.signal}`);
  const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
  if (stderr) parts.push(`stderr: ${stderr.slice(-600)}`);
  else if (e.message) parts.push(e.message);
  return parts.join(' ') || 'unknown build failure';
}

/**
 * Create an @ai-sdk/mcp stdio client wired to the CRG server.
 * Reuses the existing CRG_MCP_COMMAND / CRG_MCP_ARGS / crgEnv() constants.
 * Soft-degrades: returns null when the graph package is not installed.
 *
 * @param {{ createMCPClientImpl?: Function, TransportImpl?: any }} [opts]
 * @returns {Promise<any|null>}
 */
export async function createCrgMcpClient({ createMCPClientImpl, TransportImpl } = {}) {
  const available = await isGraphAvailable();
  if (!available) return null;

  try {
    let createMCPClient = createMCPClientImpl;
    let StdioTransport = TransportImpl;

    if (!createMCPClient) {
      const m = await import('@ai-sdk/mcp');
      createMCPClient = m.createMCPClient;
    }
    if (!StdioTransport) {
      const m = await import('@ai-sdk/mcp/mcp-stdio');
      StdioTransport = m.Experimental_StdioMCPTransport;
    }

    const client = await createMCPClient({
      transport: new StdioTransport({
        command: CRG_MCP_COMMAND,
        args: CRG_MCP_ARGS,
        env: { ...process.env, ...crgEnv() },
      }),
    });
    return client;
  } catch (err) {
    console.error('[investigator] createCrgMcpClient.error', { error: err?.message });
    return null;
  }
}

/**
 * Build the customer's code graph from the unzipped app source.
 *
 * SOFT-DEGRADE: returns { ok: true } on a clean build, { ok: false, detail }
 * on any failure (non-zero exit, timeout, spawn error). NEVER throws — the
 * caller continues with the platform graph + Read/Grep when ok is false, and
 * logs `detail` so the failure is diagnosable.
 *
 * @param {string} appCodeDir absolute path to the unzipped customer app code
 * @param {{ runner?: typeof execFileAsync }} [opts] injectable runner for tests
 * @returns {Promise<{ ok: boolean, detail?: string }>}
 */
export async function buildCustomerGraph(appCodeDir, opts = {}) {
  const runner = opts.runner || execFileAsync;
  const args = [...CRG_BUILD_ARGS, '--repo', appCodeDir];
  try {
    await runner(CRG_MCP_COMMAND, args, {
      // execFile REPLACES the child env, so pass a SCOPED env: the OS/runtime
      // vars python3.11 needs + the CRG overrides, but NOT the run's secrets.
      env: buildGraphSpawnEnv(),
      timeout: BUILD_TIMEOUT_MS,
      // Bound stdout/stderr capture so a chatty build can't balloon memory.
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true };
  } catch (err) {
    // Soft-fail: customer-graph build is best-effort. The caller emits an
    // investigation.warning and proceeds with the platform graph. We return
    // the failure detail so the caller can log WHY rather than swallowing it.
    return { ok: false, detail: buildFailureDetail(err) };
  }
}
