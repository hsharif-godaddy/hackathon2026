import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetOverride } from '@airo/ai-grants';
import { LlmClassifier } from '../classifiers/LlmClassifier.js';
import type { LlmClient, LlmGenerateArgs, AppContext, LlmAnalysisOutput } from '../types.js';
import type { SanitizedLogEntry } from '../../log-sanitizer.js';

function logLine(message: string): SanitizedLogEntry {
  return {
    timestamp: '2026-04-20T10:30:45Z',
    source: 'stderr',
    message,
    level: 'error',
  };
}

function appContext(overrides: Partial<AppContext> = {}): AppContext {
  return {
    appId: 'app-abc123',
    target: 'publish',
    contextSource: 'none',
    projectContextText: 'No project files were available for this diagnosis.',
    filesIncluded: 0,
    ...overrides,
  };
}

class FakeLlmClient implements LlmClient {
  public lastArgs: LlmGenerateArgs<unknown> | null = null;
  public calls = 0;

  constructor(private behavior: (args: LlmGenerateArgs<unknown>) => Promise<unknown>) {}

  async generateStructured<T>(args: LlmGenerateArgs<T>): Promise<T> {
    this.calls += 1;
    this.lastArgs = args;
    return (await this.behavior(args)) as T;
  }
}

const sampleOutput: LlmAnalysisOutput = {
  status: 'failing',
  primaryRecommendation: 'Install missing packages: npm install',
  issues: [
    {
      id: 'missing-deps',
      category: 'Missing Dependency',
      severity: 'error',
      message: 'Cannot find module "react"',
      recommendation: 'Run npm install to resolve dependencies',
      confidence: 92,
      relatedLogs: ['Error: Cannot find module "react"'],
    },
  ],
};

describe('LlmClassifier', () => {
  let client: FakeLlmClient;

  beforeEach(() => {
    client = new FakeLlmClient(async () => sampleOutput);
  });

  describe('source identity', () => {
    it('reports source as "llm"', () => {
      const classifier = new LlmClassifier(client);
      expect(classifier.source).toBe('llm');
    });
  });

  describe('happy path', () => {
    it('returns handled=true with issues stamped source=llm', async () => {
      const classifier = new LlmClassifier(client);
      const result = await classifier.classify(
        [logLine('Error: Cannot find module "react"')],
        appContext()
      );

      expect(result.handled).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.source).toBe('llm');
      expect(result.issues[0]!.id).toBe('missing-deps');
      expect(result.issues[0]!.recommendation).toBe('Run npm install to resolve dependencies');
    });

    it('passes BudgetOverride.DiagnoseTask as budgetUser', async () => {
      const classifier = new LlmClassifier(client);
      await classifier.classify([logLine('anything')], appContext());

      expect(client.lastArgs!.budgetUser).toBe(BudgetOverride.DiagnoseTask);
    });

    it('passes source:diagnose tag', async () => {
      const classifier = new LlmClassifier(client);
      await classifier.classify([logLine('anything')], appContext());

      expect(client.lastArgs!.tags).toContain('source:diagnose');
    });

    it('composes a system prompt containing all guideline fragments', async () => {
      const classifier = new LlmClassifier(client);
      await classifier.classify([logLine('anything')], appContext());

      const sys = client.lastArgs!.system;
      expect(sys).toContain('Platform Upload Guidelines');
      expect(sys).toContain('package.json');
      expect(sys).toContain('Dependencies');
      expect(sys).toContain('Runtime');
      expect(sys).toContain('Packaging');
      expect(sys).toContain('Framework Patterns');
      expect(sys).toContain('Log Symptom');
      expect(sys).toContain('Output Contract');
      // Placeholders must be resolved — no `{{...}}` markers remain.
      expect(sys).not.toMatch(/\{\{[A-Za-z]+\}\}/);
    });

    it('embeds app context and logs in the user message', async () => {
      const classifier = new LlmClassifier(client);
      await classifier.classify(
        [logLine('error 1'), logLine('error 2')],
        appContext({ appId: 'my-app-id' })
      );

      const user = client.lastArgs!.user;
      expect(user).toContain('my-app-id');
      expect(user).toContain('publish');
      expect(user).toContain('error 1');
      expect(user).toContain('error 2');
    });

    it('supplies a zod schema that validates the output', async () => {
      const classifier = new LlmClassifier(client);
      await classifier.classify([logLine('anything')], appContext());

      // Schema must accept our sample output and reject bad shapes.
      const schema = client.lastArgs!.schema;
      expect(schema.safeParse(sampleOutput).success).toBe(true);
      expect(schema.safeParse({ status: 'failing' }).success).toBe(false);
    });

    it('uses the configured timeout', async () => {
      const classifier = new LlmClassifier(client, { timeoutMs: 12345 });
      await classifier.classify([logLine('x')], appContext());

      expect(client.lastArgs!.timeoutMs).toBe(12345);
    });
  });

  describe('empty logs', () => {
    it('returns healthy + handled=true without calling LLM', async () => {
      const classifier = new LlmClassifier(client);
      const result = await classifier.classify([], appContext());

      expect(client.calls).toBe(0);
      expect(result.handled).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.severity).toBe('warning');
    });
  });

  describe('failure modes', () => {
    it('returns handled=true with unknown-severity issue on LLM error', async () => {
      const failing = new FakeLlmClient(async () => {
        throw new Error('upstream blew up');
      });
      const classifier = new LlmClassifier(failing);
      const result = await classifier.classify([logLine('anything')], appContext());

      expect(result.handled).toBe(true);
      expect(result.degraded).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.severity).toBe('warning');
      expect(result.issues[0]!.id).toBe('llm-failure');
      expect(result.issues[0]!.source).toBe('llm');
      expect(result.issues[0]!.message).toMatch(/unable to analyze/i);
    });

    it('returns llm-prompt-missing sentinel when a prompt file cannot be read', async () => {
      const enoent = Object.assign(new Error('ENOENT: no such file'), {
        code: 'ENOENT',
        path: '/prompts/diagnose/system.md',
      });
      const classifier = new LlmClassifier(client, {
        readFile: async () => {
          throw enoent;
        },
      });
      const result = await classifier.classify([logLine('anything')], appContext());

      expect(result.handled).toBe(true);
      expect(result.degraded).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.id).toBe('llm-prompt-missing');
      expect(result.issues[0]!.source).toBe('llm');
      expect(result.issues[0]!.recommendation).toMatch(/contact support/i);
      expect(client.calls).toBe(0);
    });

    it('classifies ENOENT from the LLM call as llm-failure, not llm-prompt-missing', async () => {
      // Regression guard: earlier versions wrapped prompt-load and the LLM call
      // in the same try, so any ENOENT (even from deep inside the LLM stack)
      // was misreported as a missing prompt file.
      const enoentFromLlm = Object.assign(new Error('ENOENT: socket path'), {
        code: 'ENOENT',
        path: '/var/run/something.sock',
      });
      const failing = new FakeLlmClient(async () => {
        throw enoentFromLlm;
      });
      const classifier = new LlmClassifier(failing);
      const result = await classifier.classify([logLine('anything')], appContext());

      expect(result.handled).toBe(true);
      expect(result.degraded).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.id).toBe('llm-failure');
      expect(result.issues[0]!.recommendation).not.toMatch(/contact support/i);
    });
  });

  describe('per-request context', () => {
    it('forwards the appId given on each call to the LLM prompt', async () => {
      const classifier = new LlmClassifier(client);

      await classifier.classify([logLine('x')], appContext({ appId: 'first-app' }));
      expect(client.lastArgs!.user).toContain('first-app');

      await classifier.classify([logLine('y')], appContext({ appId: 'second-app' }));
      expect(client.lastArgs!.user).toContain('second-app');
    });
  });

  describe('platform-outage sentinel passthrough', () => {
    const sentinelOutput: LlmAnalysisOutput = {
      status: 'unknown',
      primaryRecommendation:
        'The deployment platform is temporarily unavailable. Retry in a few minutes or contact support if the issue persists.',
      issues: [
        {
          id: 'platform-outage',
          category: 'Platform',
          severity: 'warning',
          message:
            'Logs indicate a platform or upstream infrastructure issue, not an application configuration problem.',
          recommendation:
            'Wait a few minutes and retry deployment. If failures continue, contact GoDaddy support with the cited log lines.',
          confidence: 0,
          relatedLogs: ['supervisor unavailable'],
        },
      ],
    };

    it('preserves id, source, severity, and confidence when the LLM returns the sentinel shape', async () => {
      const sentinelClient = new FakeLlmClient(async () => sentinelOutput);
      const classifier = new LlmClassifier(sentinelClient);

      const result = await classifier.classify([logLine('supervisor unavailable')], appContext());

      expect(result.handled).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.id).toBe('platform-outage');
      expect(result.issues[0]!.source).toBe('llm');
      expect(result.issues[0]!.severity).toBe('warning');
      expect(result.issues[0]!.confidence).toBe(0);
      expect(result.issues[0]!.category).toBe('Platform');
    });

    it('the sentinel shape validates against the Zod schema the classifier supplies', async () => {
      const classifier = new LlmClassifier(client);
      // First call: capture the schema the classifier passes to the LLM client.
      await classifier.classify([logLine('x')], appContext());
      const schema = client.lastArgs!.schema;

      const parsed = schema.safeParse(sentinelOutput);
      expect(parsed.success).toBe(true);
    });
  });
});
