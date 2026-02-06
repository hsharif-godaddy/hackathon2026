import { z } from 'zod';

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
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type Credentials = z.infer<typeof CredentialsSchema>;
export type PreviewScreenshot = z.infer<typeof PreviewScreenshotSchema>;
export type SitePrompt = z.infer<typeof SitePromptSchema>;

export interface ScreenshotInfo {
  path: string;
  type: 'initial' | 'final' | 'preview' | 'error';
  url?: string;
  scrollPosition?: string;
  timestamp: number;
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
}

export interface Report {
  timestamp: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  totalTokens: number;
  totalDuration: number;
  results: EvalResult[];
}
