import { Client } from '@elastic/elasticsearch';

import type { EvalResult, Report } from '../scenarios/types.js';

const ES_INDEX = 'agentic-qa-results';

export interface ElasticsearchConfig {
  url: string;
  username?: string;
  password?: string;
  apiKey?: string;
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
  uniqueActionTypes: string[];
  uniquePageUrls: string[];
  pageUrlCount: number;
  finalPageUrl?: string;
  firstActionTimestamp?: string;
  lastActionTimestamp?: string;
  actionDurationMs?: number;

  // Screenshots summary (clean fields for Kibana)
  screenshotCount: number;
  previewScreenshotCount: number;
  // Base64-encoded screenshot images
  screenshots: Array<{
    type: string;
    url?: string;
    scrollPosition?: string;
    timestamp: string;
    base64: string;
  }>;

  // Quality evaluation metrics
  qualityScore?: number;
  qualityGrade?: string;
  performanceScore?: number;
  accessibilityScore?: number;
  accessibilityViolationsCritical?: number;
  accessibilityViolationsSerious?: number;
  seoScore?: number;
  functionalScore?: number;
  functionalJsErrors?: number;
  functionalBrokenLinks?: number;
  visualScore?: number;
  visualPlaceholders?: number;
  contentScore?: number;
  contentRelevance?: number;
  contentCoherence?: number;
  securityScore?: number;
  securityIsHttps?: boolean;
  usabilityScore?: number;
  businessFitScore?: number;
  businessFitSiteType?: string;
  qualityCriticalIssues?: string[];
  qualityRecommendations?: string[];

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

  // Timestamp
  timestamp: string;

  // Test result details
  previewUrl?: string;
  error?: string;
  errorType?: string;

  // Model info
  model: string;

  // Credit mode metrics
  creditsUsed?: number;
  chatMessagesCompleted?: number;
  creditLimit?: number;
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
 * Ensure the index exists with proper mappings for binary screenshot data.
 * Elasticsearch can't auto-map base64 strings — they must be declared as `binary` type.
 */
async function ensureIndex(client: Client, index: string): Promise<void> {
  const exists = await client.indices.exists({ index });
  if (exists) {
    // Update mapping for existing index — adds binary type for new screenshots field.
    // This only works if the field doesn't already exist with a different type.
    try {
      await client.indices.putMapping({
        index,
        body: {
          properties: {
            screenshots: {
              type: 'nested',
              properties: {
                type: { type: 'keyword' },
                url: { type: 'keyword' },
                scrollPosition: { type: 'keyword' },
                timestamp: { type: 'date' },
                base64: { type: 'binary' },
              },
            },
          },
        },
      });
    } catch {
      // Mapping conflict — field exists with incompatible type.
      // Delete and recreate the index to apply correct mappings.
      console.warn('Recreating index %s due to mapping conflict with screenshots field', index);
      await client.indices.delete({ index });
      return ensureIndex(client, index);
    }
    return;
  }

  await client.indices.create({
    index,
    body: {
      mappings: {
        properties: {
          screenshots: {
            type: 'nested',
            properties: {
              type: { type: 'keyword' },
              url: { type: 'keyword' },
              scrollPosition: { type: 'keyword' },
              timestamp: { type: 'date' },
              base64: { type: 'binary' },
            },
          },
        },
      },
    },
  });
}

/**
 * Transform EvalResult to fully indexable document with ALL available data
 */
function toIndexableResult(result: EvalResult): IndexableResult {
  const uniqueActionTypes = [...new Set(result.actions.map(a => a.type))];

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
    actionCount: result.actions.length,
    uniqueActionTypes,
    uniquePageUrls,
    pageUrlCount: uniquePageUrls.length,
    finalPageUrl: lastAction?.pageUrl,
    firstActionTimestamp: firstAction ? new Date(firstAction.timestamp).toISOString() : undefined,
    lastActionTimestamp: lastAction ? new Date(lastAction.timestamp).toISOString() : undefined,
    actionDurationMs: firstAction && lastAction ? lastAction.timestamp - firstAction.timestamp : undefined,

    // Screenshots summary (clean fields for Kibana)
    screenshotCount: result.screenshots.length,
    previewScreenshotCount: result.screenshots.filter(s => s.type === 'preview').length,
    screenshots: result.screenshots
      .filter(s => s.base64)
      .map(s => ({
        type: s.type,
        url: s.url,
        scrollPosition: s.scrollPosition,
        timestamp: new Date(s.timestamp).toISOString(),
        base64: s.base64!,
      })),

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

    // Timestamp
    timestamp: new Date().toISOString(),

    // Test result details
    previewUrl: result.previewUrl,
    error: result.error,
    errorType: extractErrorType(result.error),

    // Model info
    model: process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || 'unknown',

    // Credit mode metrics
    creditsUsed: result.creditsUsed,
    chatMessagesCompleted: result.chatMessagesCompleted,
    creditLimit: result.creditLimit,

    // Quality evaluation metrics
    qualityScore: result.quality?.overall.score,
    qualityGrade: result.quality?.overall.grade,
    performanceScore: result.quality?.performance?.score,
    accessibilityScore: result.quality?.accessibility?.score,
    accessibilityViolationsCritical: result.quality?.accessibility?.violations.critical,
    accessibilityViolationsSerious: result.quality?.accessibility?.violations.serious,
    seoScore: result.quality?.seo?.score,
    functionalScore: result.quality?.functional?.score,
    functionalJsErrors: result.quality?.functional?.jsErrors.length,
    functionalBrokenLinks: result.quality?.functional?.brokenLinks.length,
    visualScore: result.quality?.visual?.score,
    visualPlaceholders: result.quality?.visual?.placeholders.length,
    contentScore: result.quality?.content?.score,
    contentRelevance: result.quality?.content?.relevance,
    contentCoherence: result.quality?.content?.coherence,
    securityScore: result.quality?.security?.score,
    securityIsHttps: result.quality?.security?.isHttps,
    usabilityScore: result.quality?.usability?.score,
    businessFitScore: result.quality?.businessFit?.score,
    businessFitSiteType: result.quality?.businessFit?.siteType,
    qualityCriticalIssues: result.quality?.overall.criticalIssues,
    qualityRecommendations: result.quality?.overall.recommendations,
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
    await ensureIndex(client, index);
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
    await ensureIndex(client, index);

    const operations = results.flatMap(result => [
      { index: { _index: index } },
      toIndexableResult(result),
    ]);

    const response = await client.bulk({ operations, refresh: true });

    if (response.errors) {
      const erroredDocs = response.items.filter((item: { index?: { error?: unknown } }) => item.index?.error);
      console.error('%d documents failed to index', erroredDocs.length);
      for (const doc of erroredDocs.slice(0, 3)) {
        console.error('  Index error: %O', doc.index?.error);
      }
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
