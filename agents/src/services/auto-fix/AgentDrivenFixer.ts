/**
 * Agent-driven fallback for auto-fix.
 *
 * When diagnose identifies issues but the LLM produces no executable
 * `actions[]` (e.g. an arbitrary type error in user code with only a
 * recommendation string), we hand the analysis to the develop agent and
 * let its tool loop apply the fix in the preview workspace. The agent
 * already has file-edit, terminal, and read tools registered against
 * `executionContext.metadata.appId` — see develop-agent.ts.
 *
 * This module intentionally takes a structural `AgentInvoker` type rather
 * than the concrete AgentWrapper class so tests can fake it without
 * pulling the full ai-lib factory in.
 */
import { Logger } from '../../logging/index.js';
import type { Analysis } from '../diagnose/types.js';

const logger = Logger.create({ component: 'auto-fix.agent-fixer' });

/**
 * Cap the prompt size. Real diagnose runs typically have 1–3 issues with a
 * handful of log lines each, so these caps keep the prompt well under the
 * model's input budget while preserving enough context to act on.
 */
const MAX_LOGS_PER_ISSUE = 3;
const MAX_ISSUES_IN_PROMPT = 10;
/** Trim the agent's final assistant message before surfacing it as `summary`. */
const SUMMARY_MAX_CHARS = 4000;
/** Hard ceiling on a single agent run. The develop agent's per-step timeout is 10 minutes. */
const DEFAULT_TIMEOUT_MS = 240_000;

export interface AgentFixResult {
  success: boolean;
  /** Trimmed final assistant message — surfaced as the response's `agentFix.summary`. */
  summary: string;
  /**
   * Tool calls observed in the LAST step of the agent's loop (informational only).
   *
   * Caveat: AI SDK 6's `result.toolCalls` reports last-step calls only. If the
   * agent edits in step N and emits a final summary in step N+1, this reads 0
   * even though edits happened. Callers must NOT gate decisions on this — rely
   * on the post-restart diagnose to determine whether the workspace is healthy.
   */
  toolCallCount: number;
  /** Set when the fixer couldn't run at all (factory missing, agent not registered). */
  unavailable?: boolean;
  /**
   * Set when the run was abandoned by the wrapper timeout. CRITICAL: a timeout
   * does NOT stop the underlying agent — `withTimeout` only rejects its own
   * promise; there is no AbortSignal plumbed into `AgentInvoker.generate`. The
   * develop-agent tool loop keeps running (its per-step timeout is 10 min) and
   * may keep writing to the workspace AFTER we return. Callers must therefore
   * treat the workspace as indeterminate on this path and must NOT claim a
   * clean git rollback — the orphaned agent can write again after the reset.
   */
  timedOut?: boolean;
  /** Populated on failure (timeout, agent threw). */
  error?: string;
}

/** Thrown by {@link withTimeout} so callers can distinguish a timeout from an agent throw. */
class AgentFixTimeoutError extends Error {}

export interface AgentDrivenFixer {
  applyFix(appId: string, analysis: Analysis): Promise<AgentFixResult>;
}

/**
 * Minimal structural shape we need from an AgentWrapper. Keeps this module
 * decoupled from `@airo/ai-lib` concrete types so the auto-fix unit tests
 * don't have to construct a real factory.
 */
export interface AgentInvoker {
  generate(
    prompt: string,
    options?: {
      executionContext?: Record<string, unknown>;
    },
  ): Promise<{
    content: string;
    toolCalls?: unknown;
  }>;
}

/**
 * Lazy lookup so the route can defer agent resolution until invocation —
 * the agent factory is initialized asynchronously at boot, and the auto-fix
 * service is constructed during route registration. Returning `null` here
 * is treated as `unavailable` (no agent in the registry).
 */
export type AgentInvokerResolver = () => AgentInvoker | null;

export interface DevelopAgentFixerOptions {
  timeoutMs?: number;
}

export class DevelopAgentFixer implements AgentDrivenFixer {
  private readonly resolveAgent: AgentInvokerResolver;
  private readonly timeoutMs: number;

  constructor(resolveAgent: AgentInvokerResolver, options?: DevelopAgentFixerOptions) {
    this.resolveAgent = resolveAgent;
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async applyFix(appId: string, analysis: Analysis): Promise<AgentFixResult> {
    const agent = this.resolveAgent();
    if (!agent) {
      logger.warn('auto-fix.agent.unavailable', { appId });
      return {
        success: false,
        unavailable: true,
        summary: '',
        toolCallCount: 0,
        error: 'Develop agent is not available in this allocation.',
      };
    }

    const prompt = buildPrompt(analysis);
    logger.info('auto-fix.agent.invoke', {
      appId,
      issueCount: analysis.issues.length,
      promptChars: prompt.length,
    });

    try {
      const result = await withTimeout(
        agent.generate(prompt, { executionContext: { metadata: { appId } } }),
        this.timeoutMs,
      );
      const toolCallCount = countToolCalls(result.toolCalls);
      logger.info('auto-fix.agent.complete', { appId, toolCallCount });
      return {
        success: true,
        summary: (result.content ?? '').slice(0, SUMMARY_MAX_CHARS),
        toolCallCount,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const timedOut = err instanceof AgentFixTimeoutError;
      logger.warn('auto-fix.agent.failed', { appId, error: message, timedOut });
      return {
        success: false,
        summary: '',
        toolCallCount: 0,
        ...(timedOut ? { timedOut: true } : {}),
        error: message,
      };
    }
  }
}

/**
 * Build a self-contained prompt from the diagnose Analysis.
 *
 * The prompt deliberately tells the agent NOT to ask clarifying questions —
 * auto-fix is autonomous; an `askQuestion` mid-run would just stall the HTTP
 * response. The develop-agent config configures `stopAfterTools: ['askQuestion']`,
 * so a runaway question still terminates the loop instead of hanging.
 */
function buildPrompt(analysis: Analysis): string {
  const sections: string[] = [];

  sections.push(
    'The preview build for this app is currently failing. A diagnostic ' +
      'analysis has identified the issues below. Apply the recommended fixes ' +
      'directly using your file editing and terminal tools.',
  );

  sections.push(`Build status: ${analysis.status}`);

  if (analysis.summary?.primaryRecommendation) {
    sections.push(`Primary recommendation: ${analysis.summary.primaryRecommendation}`);
  }

  const issues = analysis.issues.slice(0, MAX_ISSUES_IN_PROMPT);
  if (issues.length > 0) {
    const issueBlocks = issues.map((iss, idx) => {
      const lines: string[] = [];
      lines.push(`${idx + 1}. [${iss.severity}] ${iss.category}: ${iss.message}`);
      lines.push(`   Recommendation: ${iss.recommendation}`);
      const logs = (iss.relatedLogs ?? []).slice(0, MAX_LOGS_PER_ISSUE);
      if (logs.length > 0) {
        lines.push(`   Related logs:`);
        for (const l of logs) {
          lines.push(`     - ${l}`);
        }
      }
      return lines.join('\n');
    });
    sections.push('Issues to fix:\n' + issueBlocks.join('\n\n'));
  }

  sections.push(
    'Apply the fixes autonomously — do not ask clarifying questions. ' +
      'When done, briefly describe what you changed.',
  );

  // Verification step. The diagnose logs can lag the actual workspace state
  // (the user may have applied a partial fix between attempts; build logs
  // can be cached buffers from earlier runs). Forcing the agent to run the
  // build before declaring done catches the "file looks fine, log says
  // otherwise" case — either the agent finds the real problem the logs
  // pointed at, or the build passes and we know the analysis was stale.
  sections.push(
    'Before declaring done, run the project\'s build/typecheck command ' +
      '(e.g. `npm run build` or `npx tsc --noEmit`) using the terminal tool ' +
      'and confirm it succeeds. If you initially conclude the workspace is ' +
      'already correct and no edits are needed, run the build anyway — that ' +
      'is the only way to verify the analysis logs are not stale. If the ' +
      'build fails, the failure output is the source of truth; act on it.',
  );

  return sections.join('\n\n');
}

function countToolCalls(toolCalls: unknown): number {
  return Array.isArray(toolCalls) ? toolCalls.length : 0;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AgentFixTimeoutError(`Agent fix timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
