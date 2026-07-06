/**
 * Turnscript shared result/telemetry types.
 *
 * The orchestration script no longer runs in an in-process `node:vm`;
 * it runs inside the customer preview container via the production `/exec` path
 * (see runner.ts + runtime/shim.mjs). These types are the contract between the
 * in-container shim's JSON result envelope, the runner that parses it, and
 * turnscript-tool.ts's `formatTurnscriptResult` — kept stable so the admit-on-failure
 * logic and eval telemetry are unchanged.
 */

export interface DispatchRecord {
  tool: string
  ms: number
  ok: boolean
  status: 'ok' | 'conflict' | 'error' | 'throw'
  resultBytes: number
  /** Error message when the underlying dispatch failed. The failure is captured
   * rather than propagated so one failed dispatch does not abort the whole script;
   * the message is surfaced to the model via formatTurnscriptResult. */
  error?: string
}

/**
 * Why an orchestration script ended up `ok:false`, so the tool layer can give the
 * model an actionable, kind-specific recovery message (and the eval can bucket
 * failures). `runtime_throw` means the script threw at the top level (its error is
 * genuine and should be surfaced verbatim); the rest are conditions where rewriting
 * the same script is unlikely to help.
 *
 * Container-orchestration mapping (runner.ts): node parse error -> `compile`,
 * `/exec` timeout -> `timeout`, dispatch-cap exceeded -> `dispatch_cap`, a non-function
 * script -> `not_a_function`, empty input -> `empty`, a truncated/undecodable result
 * transport -> `result_unreadable`. `blocked` is retained for back-compat but no longer
 * emitted (the vm lexical denylist is gone).
 *
 * `result_unreadable` is distinct on purpose: the script RAN and likely applied its edits,
 * but its result envelope couldn't be transported back intact. It is NOT a recoverable kind
 * (re-running could double-apply) — the tool layer tells the model to re-verify file state
 * rather than retry.
 */
export type TurnscriptFailureKind =
  | 'empty'
  | 'blocked'
  | 'compile'
  | 'not_a_function'
  | 'dispatch_cap'
  | 'timeout'
  | 'runtime_throw'
  | 'result_unreadable'

export interface TurnscriptResult {
  ok: boolean
  result: unknown
  error?: string
  failureKind?: TurnscriptFailureKind
  logs: string[]
  dispatches: DispatchRecord[]
  /** Workspace-relative paths written by str_replace/create/insert dispatches (deduped, reads
   * excluded). Surfaced so the tool layer can tell the client which files this run modified —
   * the develop-page overlay dismisses on a src/pages/index write, otherwise invisible since
   * turnscript applies its edits opaquely inside the sandbox. Optional: absent on older
   * envelopes / result-transport failures, so consumers default to []. */
  editedPaths?: string[]
}
