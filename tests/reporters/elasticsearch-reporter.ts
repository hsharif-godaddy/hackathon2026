import { Client } from '@elastic/elasticsearch';

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

const ES_INDEX = 'playwright-e2e-results';

interface ConsolidatedRunDocument {
  success: boolean;
  status: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;

  duration: number;
  durationSeconds: number;
  durationMinutes: number;

  // Environment
  environment: string;
  baseUrl: string;
  projectName: string;

  // CI/CD context
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
}

interface CollectedResult {
  test: TestCase;
  result: TestResult;
}

function createClient(): Client | null {
  const url = process.env.ES_URL;

  if (!url) return null;

  const clientConfig: {
    node: string;
    auth?: { username: string; password: string } | { apiKey: string };
  } = { node: url };

  if (process.env.ES_API_KEY) {
    clientConfig.auth = { apiKey: process.env.ES_API_KEY };
  } else if (process.env.ES_USERNAME && process.env.ES_PASSWORD) {
    clientConfig.auth = {
      username: process.env.ES_USERNAME,
      password: process.env.ES_PASSWORD,
    };
  }

  return new Client(clientConfig);
}

function buildDocument(
  results: CollectedResult[],
  runResult: FullResult,
  baseUrl: string,
): ConsolidatedRunDocument {
  const passed = results.filter(r => r.result.status === 'passed').length;
  const failed = results.filter(r => r.result.status === 'failed' || r.result.status === 'timedOut').length;
  const skipped = results.filter(r => r.result.status === 'skipped' || r.result.status === 'interrupted').length;

  return {
    success: failed === 0,
    status: runResult.status,
    totalTests: results.length,
    passed,
    failed,
    skipped,

    duration: runResult.duration,
    durationSeconds: Math.round(runResult.duration / 1000 * 10) / 10,
    durationMinutes: Math.round(runResult.duration / 60000 * 10) / 10,

    environment: process.env.TEST_ENVIRONMENT || 'local',
    baseUrl,
    projectName: results[0]?.test.parent.project()?.name || 'unknown',

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

    timestamp: new Date().toISOString(),
    indexedAt: new Date().toISOString(),
  };
}

class ElasticsearchReporter implements Reporter {
  private results: CollectedResult[] = [];
  private baseUrl = '';

  onBegin(config: FullConfig, _suite: Suite): void {
    this.baseUrl = config.projects[0]?.use?.baseURL || '';
    if (process.env.ES_URL) {
      console.log(`[ES Reporter] Collecting results for Elasticsearch index: ${ES_INDEX}`);
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const existingIndex = this.results.findIndex(r => r.test.id === test.id);
    if (existingIndex !== -1) {
      this.results[existingIndex] = { test, result };
    } else {
      this.results.push({ test, result });
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    const client = createClient();
    if (!client) return;

    if (this.results.length === 0) return;

    const passed = this.results.filter(r => r.result.status === 'passed').length;
    const failed = this.results.filter(r => r.result.status === 'failed' || r.result.status === 'timedOut').length;
    const skipped = this.results.filter(r => r.result.status === 'skipped' || r.result.status === 'interrupted').length;

    console.log(`[ES Reporter] Indexing consolidated run (${passed} passed, ${failed} failed, ${skipped} skipped)`);

    try {
      await client.cluster.health({ timeout: '5s' });
    } catch (error) {
      console.error('[ES Reporter] Elasticsearch connection failed:', (error as Error).message);
      return;
    }

    try {
      await client.index({
        index: ES_INDEX,
        document: buildDocument(this.results, result, this.baseUrl),
        refresh: 'wait_for',
      });

      console.log(`[ES Reporter] Successfully indexed run summary to ${ES_INDEX}`);
    } catch (error) {
      console.error('[ES Reporter] Failed to index run summary:', (error as Error).message);
    }
  }
}

export default ElasticsearchReporter;
