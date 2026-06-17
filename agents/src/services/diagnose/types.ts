import { z } from 'zod';
import type { BudgetOverride } from '@airo/ai-grants';
import type { SanitizedLogEntry } from '../log-sanitizer.js';

export type DiagnoseTarget = 'preview' | 'publish';

export type DiagnoseContextSource = 'snapshot' | 'workspace' | 'none';
export type DiagnoseImportSource = 'zip' | 'git_pull' | 'git_push';

export type IssueSeverity = 'error' | 'warning';

export type ClassifierSource = 'pattern' | 'embedding' | 'llm';

export type AnalysisStatus = 'healthy' | 'failing' | 'degraded' | 'unknown' | 'noerrlog';

export type DiagnoseTier = 'pattern' | 'embedding' | 'llm';

export type DiagnoseErrorCode =
  | 'CAP_EXCEEDED'
  | 'SUPERVISOR_UNAVAILABLE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'APP_NOT_FOUND'
  | 'LLM_FAILURE'
  | 'VALIDATION_ERROR'
  | 'ANOTHER_DIAGNOSE_IN_FLIGHT'
  | 'PRODUCT_NOT_ALLOWED'
  | 'TIER_NOT_IMPLEMENTED'
  | 'UNKNOWN';

export type DiagnoseAction =
  | { type: 'command'; command: string; cwd?: string }
  | {
      type: 'file_edit';
      path: string;
      description: string;
      before?: string;
      after?: string;
    };

export interface Issue {
  id: string;
  category: string;
  severity: IssueSeverity;
  message: string;
  recommendation: string;
  confidence: number;
  source: ClassifierSource;
  relatedLogs?: string[];
  actions?: DiagnoseAction[];
}

export interface AnalysisSummary {
  totalIssues: number;
  errors: number;
  warnings: number;
  primaryRecommendation: string;
}

export interface AnalysisMetadata {
  logsAnalyzed: number;
  tierUsed: DiagnoseTier;
  analysisTimeMs: number;
  filesIncluded?: number;
  contextSource?: DiagnoseContextSource;
  creditsUsed?: number;
  creditsRemaining?: number;
}

export interface Analysis {
  status: AnalysisStatus;
  issues: Issue[];
  summary: AnalysisSummary;
  metadata: AnalysisMetadata;
}

export interface DiagnoseRequest {
  appId: string;
  target: DiagnoseTarget;
  /** Analysis tier. Only 'llm' is supported; 'pattern' is legacy. 'embedding' is reserved. */
  tier?: DiagnoseTier;
  /**
   * Optional ISO 8601 lower bound for the log-fetch window. When set, it
   * overrides the default 3-hour lookback. Auto-fix uses this to scope the
   * post-restart verify to logs emitted *after* the restart began, so the
   * pre-fix errors that triggered the fix can't be re-counted as a fresh
   * failure. Omit for normal diagnose (full 3-hour window).
   */
  since?: string;
}

export type DiagnoseResponse =
  | { success: true; analysis: Analysis }
  | { success: false; error: string; errorCode: DiagnoseErrorCode; analysis: Analysis };

/** Pure classifier: given sanitized log lines, return issues it can confidently identify. */
export interface Classifier {
  readonly source: ClassifierSource;
  classify(logs: SanitizedLogEntry[], context: AppContext): Promise<ClassifierResult>;
}

export interface ClassifierResult {
  issues: Issue[];
  /** True when this classifier produced a confident answer; false means fall through to next tier. */
  handled: boolean;
  /**
   * True when the classifier produced a synthetic fallback (platform misconfig,
   * upstream failure) instead of a real classification. Issues on a degraded
   * result should not be treated as real findings; the orchestrator typically
   * surfaces this as a failure response with errorCode LLM_FAILURE.
   *
   * Narrowed to literal `true`: degraded is either true or absent — there is
   * no `degraded: false` state. The orchestrator's `=== true` check at
   * PaaSDiagnoseService survives the narrowing and stays defensive.
   */
  degraded?: true;
  /** Overall status reported by the classifier. When absent, the service derives from issue severity. */
  status?: AnalysisStatus;
  /** Synthesized headline recommendation. When absent, the service falls back to issues[0].recommendation. */
  primaryRecommendation?: string;
}

/**
 * Abstraction over the underlying LLM so classifiers can be tested without mocking the ai-sdk.
 */
export interface LlmClient {
  generateStructured<T>(args: LlmGenerateArgs<T>): Promise<T>;
}

export interface LlmGenerateArgs<T> {
  system: string;
  user: string;
  schema: z.ZodSchema<T>;
  timeoutMs: number;
  budgetUser: BudgetOverride;
  tags: string[];
  functionId?: string;
  maxOutputTokens?: number;
}

/**
 * Zod schema that the LLM response is validated against.
 * Mirrors the Issue shape (without `source`, which is stamped by the classifier).
 */
export const LlmActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('command'),
    command: z.string().min(1),
    cwd: z.string().optional(),
  }),
  z.object({
    type: z.literal('file_edit'),
    path: z.string().min(1),
    description: z.string().min(1),
    before: z.string().optional(),
    after: z.string().optional(),
  }),
]);

export const LlmIssueSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  severity: z.enum(['error', 'warning']),
  message: z.string().min(1),
  recommendation: z.string().min(1),
  confidence: z.number().min(0).max(100),
  relatedLogs: z.array(z.string()).max(3).optional(),
  actions: z.array(LlmActionSchema).max(5).optional(),
});

export const LlmAnalysisSchema = z.object({
  // 'noerrlog' is set by the service before any classifier runs; the LLM never produces it.
  status: z.enum(['healthy', 'failing', 'degraded', 'unknown']),
  primaryRecommendation: z.string().min(1),
  issues: z.array(LlmIssueSchema).min(1),
});

export type LlmAnalysisOutput = z.infer<typeof LlmAnalysisSchema>;

/** Shared diagnose request fields for every classifier tier. */
export interface AppContextBase {
  appId: string;
  target: DiagnoseTarget;
  logSource?: 'customer' | 'import_job';
  importSource?: DiagnoseImportSource;
  errorStage?: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
}

/** Classifier / LLM context after project files are gathered. */
export type AppContext =
  | (AppContextBase & {
      contextSource: 'none';
      projectContextText: string;
      filesIncluded: number;
    })
  | (AppContextBase & {
      contextSource: 'snapshot';
      snapshotPath: string;
      projectContextText: string;
      filesIncluded: number;
    })
  | (AppContextBase & {
      contextSource: 'workspace';
      projectContextText: string;
      filesIncluded: number;
    });

export interface DiagnoseContextGatherResult {
  projectContextText: string;
  contextSource: DiagnoseContextSource;
  filesIncluded: number;
}

/** Build a validated AppContext from gather output (enforces cross-field invariants). */
export function buildAppContext(
  base: AppContextBase & { snapshotPath?: string },
  gather: DiagnoseContextGatherResult
): AppContext {
  const shared = {
    ...base,
    projectContextText: gather.projectContextText,
    filesIncluded: gather.filesIncluded,
  };

  if (gather.contextSource === 'snapshot' && base.snapshotPath) {
    return { ...shared, contextSource: 'snapshot', snapshotPath: base.snapshotPath };
  }
  if (gather.contextSource === 'workspace') {
    return { ...shared, contextSource: 'workspace' };
  }
  return { ...shared, contextSource: 'none' };
}
