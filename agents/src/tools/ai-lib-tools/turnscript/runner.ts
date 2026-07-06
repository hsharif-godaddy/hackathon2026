import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { logger } from '../../../logging/index.js'
import { createForWorkspace } from '../../../workspace/index.js'
import type { TurnscriptFailureKind, TurnscriptResult, DispatchRecord } from './executor.js'

/**
 * In-container runner — executes a model-authored turnscript orchestration script INSIDE
 * the customer preview container via the production `/exec` path (Landlock + cgroups
 * + SELinux), instead of in an in-process `node:vm`.
 *
 * Flow: read the in-container shim source (runtime/shim.mjs) once, prepend the model's
 * orchestration function, write the combined script to the shared workspace under
 * `.airo/`, run `node .airo/turnscript-<id>.mjs` via the workspace tasks API, and parse
 * the base64 `__TURNSCRIPT_CHUNK` envelope the shim prints on stdout. The shim re-creates
 * the `turnscript.*` API over node's `fs` and child-process APIs and ports the edit guards, so the
 * model's contract is unchanged while the orchestration runs in the sandbox.
 *
 * Result transport is 100% Workspace-API-native: the script is staged via
 * `workspace.files.write` and run via `workspace.tasks.runCommandSync`, and the result
 * comes back in that command's stdout (chunked to dodge the per-line output cap) — no
 * direct host-filesystem read, so it works even when the agent doesn't share the
 * preview's filesystem (per-customer-agent / multi-app-runtime).
 */

const SHIM_SOURCE = readFileSync(fileURLToPath(new URL('./runtime/shim.mjs', import.meta.url)), 'utf8')

export interface RunTurnscriptOptions {
  appId: string | undefined
  timeoutMs?: number
  maxDispatches?: number
}

function failure(error: string, failureKind: TurnscriptFailureKind): TurnscriptResult {
  return { ok: false, result: null, error, failureKind, logs: [], dispatches: [], editedPaths: [] }
}

type TsModule = typeof import('typescript')
let tsModulePromise: Promise<TsModule> | undefined

/** Lazily load the TypeScript compiler — only when turnscript actually runs a script, so it
 * stays off the agent's startup import graph when turnscript is disabled. */
function loadTs(): Promise<TsModule> {
  if (!tsModulePromise) {
    tsModulePromise = import('typescript').then(
      m => (m as { default?: TsModule }).default ?? (m as unknown as TsModule),
    )
  }
  return tsModulePromise
}

/**
 * The model authors the orchestration script against a TypeScript-typed `turnscript.*`
 * surface (see type-gen.ts), so it naturally emits TS — type annotations, `as const`,
 * generics. node only parses plain JS, so those would SyntaxError in-container. Strip the
 * types via tsc's emit before shipping. If TS reports a genuine SYNTAX error (diagnostic
 * code < 2000) return the source unchanged so the in-container node surfaces the real
 * error (mapped to `compile`). Any unexpected failure also falls back to the raw source —
 * transpilation must never turn a runnable script into an un-runnable one.
 */
async function transpileTsToJs(src: string): Promise<string> {
  try {
    const ts = await loadTs()
    const out = ts.transpileModule(src, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        isolatedModules: true,
      },
      reportDiagnostics: true,
    })
    const hasSyntaxError = (out.diagnostics ?? []).some(
      d => d.category === ts.DiagnosticCategory.Error && d.code < 2000,
    )
    if (hasSyntaxError) return src
    return out.outputText.trim() || src
  } catch {
    return src
  }
}

/**
 * Assemble the full in-container script: the shim source, then the model's orchestration
 * fn (TS-stripped) assigned to the global the shim's (async) runner invokes. Appended
 * after the shim so module-scoped `turnscript`/`console` bindings are initialized and there
 * is no statement-before-import concern.
 */
export async function buildScript(userCode: string): Promise<string> {
  const assignment = await transpileTsToJs(`globalThis.__turnscriptUserFn = (\n${userCode}\n);`)
  return `${SHIM_SOURCE}\n${assignment}\n`
}

export async function runTurnscriptInContainer(code: string, options: RunTurnscriptOptions): Promise<TurnscriptResult> {
  const trimmed = (code ?? '').trim()
  if (!trimmed) return failure('empty script', 'empty')

  const { appId, timeoutMs = 30000, maxDispatches = 200 } = options
  if (!appId) return failure('appId is required for turnscript execution', 'runtime_throw')

  const workspace = createForWorkspace(appId, 'preview')
  if (!workspace) return failure('workspace unavailable — dev-supervisor unreachable; cannot run turnscript', 'runtime_throw')

  const id = Math.random().toString(36).slice(2, 10)
  const rel = `.airo/turnscript-${id}.mjs`
  const cleanup = (): void => {
    workspace.tasks.runCommandSync({ command: `rm -f ${rel}`, timeoutSeconds: 10 }).catch((err: unknown) => {
      logger.warn('turnscript.cleanup.failed', { rel, error: err instanceof Error ? err.message : String(err) })
    })
  }

  try {
    await workspace.files.write({ path: rel, content: await buildScript(trimmed) })
  } catch (err) {
    return failure(`failed to stage turnscript script: ${err instanceof Error ? err.message : String(err)}`, 'runtime_throw')
  }

  let stdout = ''
  let stderr = ''
  let timedOut = false
  try {
    const res = await workspace.tasks.runCommandSync({
      command: `node ${rel}`,
      timeoutSeconds: Math.ceil(timeoutMs / 1000),
      env: { TURNSCRIPT_MAX_DISPATCHES: String(maxDispatches) },
    })
    stdout = res.stdout ?? ''
    stderr = res.stderr ?? ''
    timedOut = !!res.timedOut
  } catch (err) {
    cleanup()
    return failure(`turnscript exec failed: ${err instanceof Error ? err.message : String(err)}`, 'runtime_throw')
  }

  cleanup()
  return parseEnvelope(stdout, stderr, timedOut)
}

/** Valid TurnscriptFailureKind values — used to reject a spoofed/unknown kind coming from
 * the (untrusted) model-authored script's envelope. */
const VALID_FAILURE_KINDS: ReadonlySet<string> = new Set<TurnscriptFailureKind>([
  'empty', 'blocked', 'compile', 'not_a_function', 'dispatch_cap', 'timeout', 'runtime_throw', 'result_unreadable',
])

/** Shape-guard one dispatch record. The envelope is model-controlled, so elements that don't
 * match the contract are dropped rather than trusted (formatTurnscriptResult and dispatch
 * logging read .tool/.status/.ok/.ms off these). */
function isDispatchRecord(d: unknown): d is DispatchRecord {
  if (!d || typeof d !== 'object') return false
  const r = d as Record<string, unknown>
  return typeof r.tool === 'string'
    && typeof r.ms === 'number'
    && typeof r.ok === 'boolean'
    && typeof r.status === 'string'
    && typeof r.resultBytes === 'number'
}

/** Build a TurnscriptResult from an envelope JSON string; null if it doesn't parse. The
 * envelope is emitted by a model-authored script (an untrusted boundary), so failureKind and
 * dispatch element shapes are validated here rather than cast through. */
export function parseEnvelopeJson(json: string): TurnscriptResult | null {
  try {
    const env = JSON.parse(json) as Partial<TurnscriptResult>
    const ok = !!env.ok
    // On failure, coerce an unknown/spoofed failureKind to the non-recoverable `runtime_throw`
    // (so RECOVERABLE_FAILURE_KINDS / formatTurnscriptResult never read an unchecked value);
    // on success there is no failureKind.
    const failureKind: TurnscriptFailureKind | undefined = ok
      ? undefined
      : (typeof env.failureKind === 'string' && VALID_FAILURE_KINDS.has(env.failureKind)
          ? (env.failureKind as TurnscriptFailureKind)
          : 'runtime_throw')
    return {
      ok,
      result: env.result ?? null,
      error: typeof env.error === 'string' ? env.error : undefined,
      failureKind,
      logs: Array.isArray(env.logs) ? env.logs.filter((l): l is string => typeof l === 'string') : [],
      dispatches: Array.isArray(env.dispatches) ? env.dispatches.filter(isDispatchRecord) : [],
      editedPaths: Array.isArray(env.editedPaths) ? env.editedPaths.filter((p): p is string => typeof p === 'string') : [],
    }
  } catch {
    return null
  }
}

/**
 * Parse the shim's stdout transport. The shim emits the result envelope as base64 across
 * `__TURNSCRIPT_CHUNK <i>/<n> <data>` lines (each under the dev-supervisor per-line cap); we
 * reassemble by index, decode, and JSON-parse.
 *
 * A missing/short chunk set means the transport was truncated — but the script very likely
 * SUCCEEDED and may have already applied edits, so this is classified `result_unreadable`,
 * deliberately NOT a recoverable kind: re-running the same script could double-apply. Only
 * when no chunks were emitted at all do we fall back to the stderr/timeout heuristic for a
 * script that crashed before producing any result.
 */
export function parseEnvelope(stdout: string, stderr: string, timedOut: boolean): TurnscriptResult {
  const chunks = new Map<number, string>()
  let total: number | undefined
  for (const m of stdout.matchAll(/^__TURNSCRIPT_CHUNK (\d+)\/(\d+) (\S+)$/gm)) {
    total = Number(m[2])
    chunks.set(Number(m[1]), m[3] ?? '')
  }

  if (total !== undefined) {
    const complete = chunks.size === total && Array.from({ length: total }, (_, i) => i).every(i => chunks.has(i))
    if (!complete) {
      logger.warn('turnscript.envelope.truncated', { expected: total, received: chunks.size })
      return failure(`turnscript result transport truncated (${chunks.size}/${total} chunks received)`, 'result_unreadable')
    }
    const b64 = Array.from({ length: total }, (_, i) => chunks.get(i) ?? '').join('')
    const parsed = parseEnvelopeJson(Buffer.from(b64, 'base64').toString('utf8'))
    if (parsed) return parsed
    logger.warn('turnscript.envelope.decode_failed', { chunks: total })
    return failure('turnscript result could not be decoded from transport', 'result_unreadable')
  }

  // No envelope chunks at all: the script crashed/timed out before printing a result.
  if (timedOut) return failure('turnscript script timed out', 'timeout')
  const errText = (stderr || stdout).trim().slice(0, 2000)
  const isCompile = /SyntaxError|Unexpected (token|identifier|end of input)|is not defined/.test(errText)
  return failure(errText || 'turnscript produced no result', isCompile ? 'compile' : 'runtime_throw')
}
