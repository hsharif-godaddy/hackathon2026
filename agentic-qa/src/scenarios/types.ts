import { z } from 'zod';

import type { QualityEvaluation } from '../quality/types.js';

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
  }).default({}),
});

export const ScenarioSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  startUrl: z.string().url(),
  timeout: z.number().default(300000),
  maxSteps: z.number().default(50),
  headed: z.boolean().default(false),
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
  // Budget mode: keep sending chatMessages until app has spent this much (USD)
  tokenBudgetUSD: z.number().positive().optional(),
  // Iterative chat messages to send one-by-one (used with tokenBudgetUSD)
  chatMessages: z.array(z.string()).optional(),
  // Max agent steps per individual chat message (default: 20)
  stepsPerMessage: z.number().default(20),
}).refine(
  (data) => !data.tokenBudgetUSD || (data.chatMessages && data.chatMessages.length > 0),
  { message: 'tokenBudgetUSD requires a non-empty chatMessages array' }
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
  // Budget mode: incremental spend during this run (from token-budget API)
  appCostUSD?: number;
  // Budget mode: how many chat messages were completed before budget was reached
  chatMessagesCompleted?: number;
  // Budget mode: the configured budget limit
  tokenBudgetUSD?: number;
}

export interface Report {
  timestamp: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  totalTokens: number;
  totalDuration: number;
  totalAppCostUSD: number;
  results: EvalResult[];
}
