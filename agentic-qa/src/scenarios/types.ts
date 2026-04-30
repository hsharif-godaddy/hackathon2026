import { z } from 'zod';

import type { QualityEvaluation } from '../quality/types.js';
import type { BuildMetrics } from '../utils/langfuse.js';

// ── Friction detection types ──────────────────────────────────────────────────

export type FrictionPatternType =
  | 'EDIT_LOOP'           // 2+ consecutive str_replace errors on same file
  | 'GREP_SPIRAL'         // 4+ consecutive grep/search without an edit
  | 'READ_SPIRAL'         // Same file read 4+ times in 6 turns without edit
  | 'NO_PROGRESS_LOOP'    // tools/turn ratio < 0.5 for 4+ turns
  | 'REDUNDANT_EXPLORATION' // reads continue 3+ turns after successful edit
  | 'ERROR_LOOP'          // Repeated same-error-type failures (3+)
  | 'USER_CORRECTION'     // User sent a correction after agent completed
  | 'CLARIFICATION_LOOP'; // Agent asks clarifying questions repeatedly

export type FrictionSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface FrictionPattern {
  type: FrictionPatternType;
  severity: FrictionSeverity;
  /** Number of observations involved in this pattern instance */
  count: number;
  /** Indices into the ordered observations array marking the pattern window */
  startIndex: number;
  endIndex: number;
  /** Estimated wasted cost in USD for this pattern instance */
  wastedCostUSD: number;
  /** Human-readable description of the detected pattern */
  description: string;
  /** Tool names involved in this pattern */
  toolNames: string[];
}

export type RetryClassification = 'transient' | 'agent' | 'user_induced';

export interface FrictionReport {
  /** Total number of friction patterns detected */
  patternCount: number;
  /** All detected patterns */
  patterns: FrictionPattern[];
  /** Overall friction score (0 = no friction, 100 = severe friction) */
  score: number;
  /** Highest severity among all patterns */
  maxSeverity: FrictionSeverity;
  /** Retry classification counts */
  retryTransient: number;
  retryAgent: number;
  retryUserInduced: number;
  /** Total estimated wasted cost across all patterns */
  totalWastedCostUSD: number;
}

export const CredentialsSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export const CleanupSchema = z.object({
  deleteAllSitesViaAPI: z.boolean().optional(),
});

export const PreviewScreenshotSchema = z.object({
  enabled: z.boolean().default(true),
  fullPage: z.boolean().default(true),
  waitForSelector: z.string().optional(),
  waitMs: z.number().default(3000),
  scrollPositions: z.array(z.enum(['top', 'middle', 'bottom'])).default(['top', 'middle', 'bottom']),
  captureAllPages: z.boolean().default(true),
  maxPages: z.number().default(5),
});

export const SitePromptSchema = z.object({
  enabled: z.boolean().default(true),
  prompt: z.string(),
  // If true, handles login by going to SSO first (default: true)
  handleLogin: z.boolean().default(true),
});

// Quality evaluation configuration
export const QualityEvalSchema = z.object({
  enabled: z.boolean().default(true),
  siteType: z.enum([
    'landing-page', 'ecommerce', 'portfolio', 'restaurant',
    'blog', 'service-business', 'nonprofit', 'medical', 'legal',
    'fitness', 'event-planner', 'generic'
  ]).default('generic'),
  skipCategories: z.array(z.enum([
    'performance', 'accessibility', 'seo', 'functional',
    'visual', 'content', 'security', 'usability', 'businessFit'
  ])).default([]),
  thresholds: z.object({
    minOverallScore: z.number().min(0).max(100).default(70),
    minPerformance: z.number().min(0).max(100).default(50),
    minAccessibility: z.number().min(0).max(100).default(80),
  }).prefault({}),
});

const ErrorObservationSchema = z.object({
  // Langfuse observation name substring (e.g., "str_replace_based_edit_tool")
  name: z.string(),
  // Optional statusMessage substring for exact error class matching
  statusMessage: z.string().optional(),
});

const RequiredToolSchema = z.object({
  // Tool/span name substring that must appear in Langfuse observations.
  // Example: "str_replace_based_edit_tool", "terminalCommand", "publishing__publish"
  name: z.string(),
});

export const ScenarioSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  startUrl: z.url(),
  timeout: z.number().default(300000),
  maxSteps: z.number().default(50),
  headed: z.boolean().default(true),
  credentials: CredentialsSchema.optional(),
  systemPrompt: z.string().optional(),
  goal: z.string(),
  dependsOn: z.string().optional(),
  cleanup: CleanupSchema.optional(),
  previewScreenshots: PreviewScreenshotSchema.optional(),
  // Site prompt: uses Playwright selectors (no AI tokens) for login, prompt entry, and start building
  sitePrompt: SitePromptSchema.optional(),
  // Quality evaluation: evaluates the built website against quality criteria
  qualityEval: QualityEvalSchema.optional(),
  // Credit mode: keep sending chatMessages until this many credits are consumed
  creditLimit: z.number().positive().optional(),
  // Iterative chat messages to send one-by-one (used with creditLimit)
  chatMessages: z.array(z.string()).optional(),
  // Max agent steps per individual chat message (default: 20)
  stepsPerMessage: z.number().default(20),
  // Optional deterministic single chat message sent via Playwright selectors
  directChatMessage: z.string().optional(),
  // Strict Langfuse ERROR observation matcher: requires name (+ optional statusMessage)
  expectedErrorObservations: z.array(ErrorObservationSchema).optional(),
  // Match mode for expectedErrorObservations
  observationMatchMode: z.enum(['any', 'all']).default('all'),
  // Tool/span names that must be observed (ERROR or non-ERROR) in Langfuse spans
  requiredTools: z.array(RequiredToolSchema).optional(),
  // Match mode for requiredTools
  requiredToolMatchMode: z.enum(['any', 'all']).default('all'),
  // Optional Langfuse-like failure signatures expected to appear in this scenario run
  expectedFailures: z.array(z.string()).optional(),
  // Match mode for expectedFailures
  failureMatchMode: z.enum(['any', 'all']).default('any'),
}).refine(
  (data) => !data.creditLimit || (data.chatMessages && data.chatMessages.length > 0),
  { message: 'creditLimit requires a non-empty chatMessages array' }
);

export type Scenario = z.infer<typeof ScenarioSchema>;
export type Credentials = z.infer<typeof CredentialsSchema>;
export type PreviewScreenshot = z.infer<typeof PreviewScreenshotSchema>;
export type SitePrompt = z.infer<typeof SitePromptSchema>;
export type QualityEval = z.infer<typeof QualityEvalSchema>;

export interface ScreenshotInfo {
  path: string;
  type: 'final' | 'preview';
  url?: string;
  scrollPosition?: string;
  timestamp: number;
  base64?: string;
}

export interface AgentAction {
  type: string;
  reasoning?: string;
  taskCompleted: boolean;
  action?: string;
  pageUrl?: string;
  timestamp: number;
}

export interface EvalResult {
  scenario: string;
  success: boolean;
  message: string;
  steps: number;
  duration: number;
  actions: AgentAction[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
  };
  screenshots: ScreenshotInfo[];
  previewUrl?: string;
  error?: string;
  // Quality evaluation results (if enabled)
  quality?: QualityEvaluation;
  qualityStatus?: 'success' | 'failed' | 'skipped';
  qualityError?: string;
  // Credit mode: credits consumed during this run (from credit grants API)
  creditsUsed?: number;
  // Credit mode: how many chat messages were completed before credit limit was reached
  chatMessagesCompleted?: number;
  // Credit mode: the configured credit limit
  creditLimit?: number;
  // Website-building agent metrics from Langfuse
  buildMetrics?: BuildMetrics;
  // Friction detection results (from ordered Langfuse observations)
  friction?: FrictionReport;
  // Timestamps (epoch ms) when each chat message was sent — used for user-correction detection
  chatMessageTimestamps?: number[];
}

export interface Report {
  timestamp: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  totalTokens: number;
  totalDuration: number;
  totalCreditsUsed: number;
  results: EvalResult[];
}
