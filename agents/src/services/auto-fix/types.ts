import { z } from 'zod';

import type {
  Analysis,
  DiagnoseAction,
  DiagnoseErrorCode,
  DiagnoseTier,
} from '../diagnose/types.js';

/**
 * Auto-fix is preview-only by design. The publish container is immutable
 * (built from a published image), so applying file edits or commands there
 * would be discarded on the next deploy. The HTTP route rejects 'publish'
 * with VALIDATION_ERROR; this literal type enforces it at the type level too.
 */
export type AutoFixTarget = 'preview';

/**
 * Auto-fix-specific failure codes layered on top of the diagnose set. We reuse
 * the diagnose codes for any failure that happens inside the inner diagnose
 * call (logs unavailable, LLM degraded, etc.) and add codes for the
 * apply/verify pipeline:
 *
 *  - NO_ACTIONABLE_FIXES: diagnose produced issues but every issue had an
 *    empty actions[] — the LLM diagnosed but couldn't propose a fix. Surfaced
 *    as success=true with an empty appliedActions[]; this code is informational.
 *  - APPLY_FAILED: at least one action threw or returned a non-zero exit; the
 *    rollback (`git reset --hard HEAD` + `git clean`) has already run.
 *  - VERIFICATION_FAILED: actions applied cleanly, but the post-fix diagnose
 *    re-run still reported a failing/degraded analysis.
 *  - RESTART_FAILED: actions/agent edits applied and committed, but the
 *    preview dev-server restart failed. We do NOT fall through to verify in
 *    this case — without a restart the old server keeps running and emits no
 *    fresh logs, so the verify diagnose would see an empty window and wrongly
 *    report `noerrlog` (success) even though the new code was never loaded.
 *  - AGENT_FIX_FAILED: the develop-agent fallback (enableAgentFallback=true)
 *    was invoked because there were no executable actions, but the agent run
 *    itself failed (timeout, threw, or returned with no tool calls and a
 *    still-failing post-fix analysis).
 */
export type AutoFixErrorCode =
  | DiagnoseErrorCode
  | 'NO_ACTIONABLE_FIXES'
  | 'APPLY_FAILED'
  | 'VERIFICATION_FAILED'
  | 'RESTART_FAILED'
  | 'AGENT_FIX_FAILED';

export interface AutoFixRequest {
  appId: string;
  target: AutoFixTarget;
  /** Tier passthrough for the inner diagnose call. Only 'llm' is exposed via HTTP. */
  tier?: DiagnoseTier;
  /** When true, run diagnose + return planned actions without applying anything. */
  dryRun?: boolean;
  /**
   * Opt-in: when diagnose produces issues but no executable actions[] (the
   * common case for "fix this TypeScript error in user code" — diagnose can
   * recommend in prose but can't synthesize a patch), hand the analysis to
   * the develop agent and let its tool loop apply the fix. Off by default to
   * preserve the previous behavior (`NO_ACTIONABLE_FIXES`) for callers that
   * haven't opted in.
   */
  enableAgentFallback?: boolean;
}

/**
 * Per-action outcome record. The route returns these in order so callers can
 * see exactly which actions ran (and which were skipped after a failure).
 *
 * Discriminated on `status` so `error` is required exactly when (and only when)
 * the action failed — `{ status: 'applied', error }` and `{ status: 'failed' }`
 * (no error) are both compile errors, and consumers narrow with a single
 * `status === 'failed'` check.
 */
export type AppliedAction =
  | {
      action: DiagnoseAction;
      status: 'applied';
      /** Best-effort tail of stdout/stderr, or replacement/byte count for file edits. */
      output?: string;
    }
  | {
      action: DiagnoseAction;
      status: 'skipped';
      output?: string;
    }
  | {
      action: DiagnoseAction;
      status: 'failed';
      output?: string;
      /** Always populated on failure. */
      error: string;
    };

/** Derived from {@link AppliedAction} so the status set has a single source of truth. */
export type AppliedActionStatus = AppliedAction['status'];

/**
 * Outcome of a develop-agent fallback run. Present on responses where
 * enableAgentFallback was honored (success or failure). `appliedActions[]`
 * stays empty in that case — the agent applies its own changes via tools,
 * which don't map cleanly onto DiagnoseAction shapes.
 */
export interface AgentFixOutcome {
  /** Trimmed final assistant message describing what the agent did. */
  summary: string;
  /**
   * Tool calls observed in the LAST step of the agent's tool loop (informational).
   *
   * Caveat: AI SDK 6's `result.toolCalls` reports last-step calls only — if the
   * agent edited files in step N and emitted a final summary in step N+1, this
   * is 0 even though edits happened. Don't gate decisions on this; rely on the
   * post-restart `postFixAnalysis` instead.
   */
  toolCallCount: number;
}

export type AutoFixResponse =
  | {
      success: true;
      analysis: Analysis;
      postFixAnalysis: Analysis;
      appliedActions: AppliedAction[];
      restarted: boolean;
      agentFix?: AgentFixOutcome;
    }
  | {
      success: false;
      error: string;
      errorCode: AutoFixErrorCode;
      analysis: Analysis;
      postFixAnalysis?: Analysis;
      appliedActions?: AppliedAction[];
      agentFix?: AgentFixOutcome;
    };

export interface AutoFixService {
  autoFix(request: AutoFixRequest): Promise<AutoFixResponse>;
}

/**
 * Zod schema for the route handler's body. Kept here next to the request type
 * so the source of truth lives in one file. The route parses with this and
 * forwards a typed `AutoFixRequest` to the service.
 */
export const AutoFixRequestBodySchema = z.object({
  // Literal — auto-fix is preview-only. 'publish' rejects with VALIDATION_ERROR.
  target: z.literal('preview'),
  // 'embedding' and 'pattern' are reserved at the diagnose layer; reject here too.
  tier: z.enum(['llm']).optional(),
  dryRun: z.boolean().optional(),
  enableAgentFallback: z.boolean().optional(),
});
