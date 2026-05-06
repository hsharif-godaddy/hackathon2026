import { z } from 'zod';
import type { BudgetOverride } from '@airo/ai-grants';
import type { SanitizedLogEntry } from '../log-sanitizer.js';

export type DiagnoseTarget = 'preview' | 'publish';

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

export interface Issue {
  id: string;
  category: string;
  severity: IssueSeverity;
  message: string;
  recommendation: string;
  confidence: number;
  source: ClassifierSource;
  relatedLogs?: string[];
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
  /** Starting tier. Default 'pattern'. 'embedding' is reserved but not yet implemented. */
  tier?: DiagnoseTier;
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
export const LlmIssueSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  severity: z.enum(['error', 'warning']),
  message: z.string().min(1),
  recommendation: z.string().min(1),
  confidence: z.number().min(0).max(100),
  relatedLogs: z.array(z.string()).max(3).optional(),
});

export const LlmAnalysisSchema = z.object({
  // 'noerrlog' is set by the service before any classifier runs; the LLM never produces it.
  status: z.enum(['healthy', 'failing', 'degraded', 'unknown']),
  primaryRecommendation: z.string().min(1),
  issues: z.array(LlmIssueSchema).min(1),
});

export type LlmAnalysisOutput = z.infer<typeof LlmAnalysisSchema>;

/** App-level context passed to the LLM prompt. */
export interface AppContext {
  appId: string;
  target: DiagnoseTarget;
}
