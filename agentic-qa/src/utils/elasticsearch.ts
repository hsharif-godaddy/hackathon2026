import { Client } from '@elastic/elasticsearch';

import type { AgentAction, EvalResult, Report, ScreenshotInfo } from '../scenarios/types.js';

const ES_INDEX = 'agentic-qa-results';

export interface ElasticsearchConfig {
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
}

export interface IndexableAction {
  type: string;
  reasoning?: string;
  taskCompleted: boolean;
  action?: string;
  pageUrl?: string;
  timestamp: number;
  timestampISO: string;
  stepNumber: number;
}

export interface IndexableScreenshot {
  path: string;
  filename: string;
  type: 'initial' | 'final' | 'preview' | 'error';
  url?: string;
  scrollPosition?: string;
  timestamp: number;
  timestampISO: string;
}

export interface IndexableResult {
  // Test identification
  scenario: string;
  success: boolean;
  message: string;

  // Metrics
  steps: number;
  duration: number;
  durationSeconds: number;
  durationMinutes: number;

  // Token usage
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  tokensPerStep: number;
  costEstimateUSD: number;

  // Agent actions summary (clean fields for Kibana)
  actionCount: number;
  actionTypes: string[];
  uniqueActionTypes: string[];
  uniquePageUrls: string[];
  pageUrlCount: number;
  finalPageUrl?: string;
  firstActionTimestamp?: string;
  lastActionTimestamp?: string;
  actionDurationMs?: number;
  // Full actions as JSON string (for debugging, not for querying)
  actionsJson: string;

  // Screenshots summary (clean fields for Kibana)
  screenshotCount: number;
  screenshotTypes: string[];
  previewScreenshotCount: number;
  errorScreenshotCount: number;
  // Full screenshots as JSON string (for debugging)
  screenshotsJson: string;

  // CI/CD context
  environment: string;
  gitSha: string;
  gitBranch: string;
  gitRef: string;
  runId: string;
  runNumber: string;
  runAttempt: string;
  runUrl: string;
  actor: string;
  triggerActor: string;
  repository: string;
  repositoryOwner: string;
  workflow: string;
  job: string;
  eventName: string;

  // Timestamps
  timestamp: string;
  indexedAt: string;

  // Test result details
  previewUrl?: string;
  error?: string;
  errorType?: string;

  // Model info
  model: string;

  // Raw data for debugging
  rawMessage: string;
}

/**
 * Estimate cost based on token usage (Claude Sonnet pricing approximation)
 */
function estimateCost(inputTokens: number, outputTokens: number): number {
  const inputCostPer1M = 3.0;
  const outputCostPer1M = 15.0;
  return (inputTokens / 1_000_000) * inputCostPer1M + (outputTokens / 1_000_000) * outputCostPer1M;
}

/**
 * Extract error type from error message
 */
function extractErrorType(error?: string): string | undefined {
  if (!error) return undefined;
  if (error.includes('timeout') || error.includes('Timeout')) return 'timeout';
  if (error.includes('navigation') || error.includes('Navigation')) return 'navigation';
  if (error.includes('element') || error.includes('Element')) return 'element_not_found';
  if (error.includes('network') || error.includes('Network')) return 'network';
  if (error.includes('auth') || error.includes('Auth') || error.includes('login')) return 'authentication';
  return 'unknown';
}

/**
 * Create Elasticsearch client from config or environment variables
 */
export function createClient(config?: Partial<ElasticsearchConfig>): Client | null {
  const url = config?.url || process.env.ES_URL;

  if (!url) {
    console.log('Elasticsearch URL not configured, skipping indexing');
    return null;
  }

  const clientConfig: {
    node: string;
    auth?: { username: string; password: string } | { apiKey: string };
  } = { node: url };

  const apiKey = config?.apiKey || process.env.ES_API_KEY;
  const username = config?.username || process.env.ES_USERNAME;
  const password = config?.password || process.env.ES_PASSWORD;

  if (apiKey) {
    clientConfig.auth = { apiKey };
  } else if (username && password) {
    clientConfig.auth = { username, password };
  }

  return new Client(clientConfig);
}

/**
 * Transform action to indexable format
 */
function toIndexableAction(action: AgentAction, index: number): IndexableAction {
  return {
    type: action.type,
    reasoning: action.reasoning,
    taskCompleted: action.taskCompleted,
    action: action.action,
    pageUrl: action.pageUrl,
    timestamp: action.timestamp,
    timestampISO: new Date(action.timestamp).toISOString(),
    stepNumber: index + 1,
  };
}

/**
 * Transform screenshot to indexable format
 */
function toIndexableScreenshot(screenshot: ScreenshotInfo): IndexableScreenshot {
  return {
    path: screenshot.path,
    filename: screenshot.path.split('/').pop() || screenshot.path,
    type: screenshot.type,
    url: screenshot.url,
    scrollPosition: screenshot.scrollPosition,
    timestamp: screenshot.timestamp,
    timestampISO: new Date(screenshot.timestamp).toISOString(),
  };
}

/**
 * Transform EvalResult to fully indexable document with ALL available data
 */
function toIndexableResult(result: EvalResult): IndexableResult {
  const actions = result.actions.map(toIndexableAction);
  const screenshots = result.screenshots.map(toIndexableScreenshot);

  const actionTypes = result.actions.map(a => a.type);
  const uniqueActionTypes = [...new Set(actionTypes)];

  const firstAction = result.actions[0];
  const lastAction = result.actions[result.actions.length - 1];

  // Extract unique page URLs for cleaner Kibana display
  const pageUrls = result.actions.map(a => a.pageUrl).filter((url): url is string => !!url);
  const uniquePageUrls = [...new Set(pageUrls)];

  const totalTokens = result.usage.inputTokens + result.usage.outputTokens + result.usage.reasoningTokens;

  return {
    // Test identification
    scenario: result.scenario,
    success: result.success,
    message: result.message,

    // Metrics
    steps: result.steps,
    duration: result.duration,
    durationSeconds: Math.round(result.duration / 1000),
    durationMinutes: Math.round(result.duration / 60000 * 10) / 10,

    // Token usage
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    reasoningTokens: result.usage.reasoningTokens,
    totalTokens,
    tokensPerStep: result.steps > 0 ? Math.round(totalTokens / result.steps) : 0,
    costEstimateUSD: Math.round(estimateCost(result.usage.inputTokens, result.usage.outputTokens) * 10000) / 10000,

    // Agent actions summary (clean fields for Kibana)
    actionCount: actions.length,
    actionTypes,
    uniqueActionTypes,
    uniquePageUrls,
    pageUrlCount: uniquePageUrls.length,
    finalPageUrl: lastAction?.pageUrl,
    firstActionTimestamp: firstAction ? new Date(firstAction.timestamp).toISOString() : undefined,
    lastActionTimestamp: lastAction ? new Date(lastAction.timestamp).toISOString() : undefined,
    actionDurationMs: firstAction && lastAction ? lastAction.timestamp - firstAction.timestamp : undefined,
    // Full actions as JSON string (for debugging, not for querying)
    actionsJson: JSON.stringify(actions),

    // Screenshots summary (clean fields for Kibana)
    screenshotCount: screenshots.length,
    screenshotTypes: screenshots.map(s => s.type),
    previewScreenshotCount: screenshots.filter(s => s.type === 'preview').length,
    errorScreenshotCount: screenshots.filter(s => s.type === 'error').length,
    // Full screenshots as JSON string (for debugging)
    screenshotsJson: JSON.stringify(screenshots),

    // CI/CD context (comprehensive)
    environment: process.env.TEST_ENVIRONMENT || 'local',
    gitSha: process.env.GITHUB_SHA || 'local',
    gitBranch: process.env.GITHUB_REF_NAME || process.env.GITHUB_HEAD_REF || 'local',
    gitRef: process.env.GITHUB_REF || 'local',
    runId: process.env.GITHUB_RUN_ID || 'local',
    runNumber: process.env.GITHUB_RUN_NUMBER || '0',
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || '1',
    runUrl: process.env.GITHUB_RUN_ID
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '',
    actor: process.env.GITHUB_ACTOR || 'local',
    triggerActor: process.env.GITHUB_TRIGGERING_ACTOR || process.env.GITHUB_ACTOR || 'local',
    repository: process.env.GITHUB_REPOSITORY || 'local',
    repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER || 'local',
    workflow: process.env.GITHUB_WORKFLOW || 'local',
    job: process.env.GITHUB_JOB || 'local',
    eventName: process.env.GITHUB_EVENT_NAME || 'local',

    // Timestamps
    timestamp: new Date().toISOString(),
    indexedAt: new Date().toISOString(),

    // Test result details
    previewUrl: result.previewUrl,
    error: result.error,
    errorType: extractErrorType(result.error),

    // Model info
    model: process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || 'unknown',

    // Raw message for full-text search
    rawMessage: result.message,
  };
}

/**
 * Index a single test result to Elasticsearch
 */
export async function indexResult(
  client: Client,
  result: EvalResult,
  index: string = ES_INDEX
): Promise<boolean> {
  try {
    const doc = toIndexableResult(result);

    await client.index({
      index,
      document: doc,
    });

    console.log(`Indexed result for scenario: ${result.scenario}`);
    return true;
  } catch (error) {
    console.error('Failed to index result for scenario:', result.scenario, error);
    return false;
  }
}

/**
 * Index multiple test results to Elasticsearch using bulk API
 */
export async function indexResults(
  client: Client,
  results: EvalResult[],
  index: string = ES_INDEX
): Promise<{ indexed: number; failed: number }> {
  if (results.length === 0) {
    return { indexed: 0, failed: 0 };
  }

  try {
    const operations = results.flatMap(result => [
      { index: { _index: index } },
      toIndexableResult(result),
    ]);

    const response = await client.bulk({ operations, refresh: true });

    if (response.errors) {
      const erroredDocs = response.items.filter((item: { index?: { error?: unknown } }) => item.index?.error);
      console.error(`${erroredDocs.length} documents failed to index`);
      return {
        indexed: results.length - erroredDocs.length,
        failed: erroredDocs.length,
      };
    }

    console.log(`Successfully indexed ${results.length} results to ${index}`);
    return { indexed: results.length, failed: 0 };
  } catch (error) {
    console.error('Failed to bulk index results:', error);
    return { indexed: 0, failed: results.length };
  }
}

/**
 * Index a complete report to Elasticsearch
 */
export async function indexReport(
  client: Client,
  report: Report,
  index: string = ES_INDEX
): Promise<{ indexed: number; failed: number }> {
  return indexResults(client, report.results, index);
}

/**
 * Convenience function to index results if ES is configured
 */
export async function maybeIndexResults(results: EvalResult[]): Promise<void> {
  const client = createClient();
  if (!client) return;

  try {
    await client.cluster.health();

    const { indexed, failed } = await indexResults(client, results);
    console.log(`Elasticsearch: indexed ${indexed}, failed ${failed}`);
  } catch (error) {
    console.error('Elasticsearch connection failed:', error);
  }
}
