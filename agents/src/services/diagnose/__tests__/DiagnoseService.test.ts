import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DiagnoseService } from '../DiagnoseService.js';
import type {
  AppContext,
  Classifier,
  ClassifierResult,
  DiagnoseRequest,
  Issue,
} from '../types.js';
import type { CustomerLogsResponse } from '../../customer-logs-service.js';
import type { SanitizedLogEntry } from '../../log-sanitizer.js';

function makeLogs(): SanitizedLogEntry[] {
  return [
    { timestamp: '2026-04-20T10:30:45Z', source: 'stderr', message: 'boom', level: 'error' },
  ];
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'some-issue',
    category: 'Missing Dependency',
    severity: 'error',
    message: 'msg',
    recommendation: 'rec',
    confidence: 90,
    source: 'pattern',
    ...overrides,
  };
}

class FakeClassifier implements Classifier {
  public calls = 0;
  public lastLogs: SanitizedLogEntry[] | null = null;
  public lastContext: AppContext | null = null;
  constructor(
    public readonly source: Classifier['source'],
    private readonly impl: () => Promise<ClassifierResult>
  ) {}
  async classify(logs: SanitizedLogEntry[], context: AppContext): Promise<ClassifierResult> {
    this.calls += 1;
    this.lastLogs = logs;
    this.lastContext = context;
    return this.impl();
  }
}

function makeLogsService(response: CustomerLogsResponse): {
  getLogs: ReturnType<typeof vi.fn>;
} {
  return {
    getLogs: vi.fn().mockResolvedValue(response),
  };
}

function makeRequest(overrides: Partial<DiagnoseRequest> = {}): DiagnoseRequest {
  return { appId: 'app-123', target: 'publish', ...overrides };
}

describe('DiagnoseService', () => {
  let clockNow = 1000;
  const clock = () => {
    clockNow += 10;
    return clockNow;
  };

  beforeEach(() => {
    clockNow = 1000;
  });

  describe('log fetch failures', () => {
    it('returns APP_NOT_FOUND when CustomerLogsService reports missing app', async () => {
      const logs = makeLogsService({ success: false, logs: [], total: 0, error: 'App not found', code: 'APP_NOT_FOUND' });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('APP_NOT_FOUND');
      expect(pattern.calls).toBe(0);
      expect(llm.calls).toBe(0);
    });

    it('passes through SUPERVISOR_UNAVAILABLE', async () => {
      const logs = makeLogsService({ success: false, logs: [], total: 0, error: 'Supervisor down', code: 'SUPERVISOR_UNAVAILABLE' });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('SUPERVISOR_UNAVAILABLE');
    });

    it('maps unknown log-service codes to UNKNOWN', async () => {
      const logs = makeLogsService({ success: false, logs: [], total: 0, error: 'something', code: 'SOME_OTHER' });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.errorCode).toBe('UNKNOWN');
    });

    it.each([
      ['SUPERVISOR_NOT_CONFIGURED', 'UPSTREAM_UNAVAILABLE'],
      ['FETCH_ERROR', 'UPSTREAM_UNAVAILABLE'],
      ['MISSING_TARGET', 'VALIDATION_ERROR'],
      ['INVALID_TARGET', 'VALIDATION_ERROR'],
      ['INVALID_LINES', 'VALIDATION_ERROR'],
      ['INVALID_TIMESTAMP', 'VALIDATION_ERROR'],
    ] as const)('maps log-service code %s to DiagnoseErrorCode %s', async (rawCode, expected) => {
      const logs = makeLogsService({ success: false, logs: [], total: 0, error: 'x', code: rawCode });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.errorCode).toBe(expected);
    });
  });

  describe('tier selection', () => {
    it('returns pattern tier result when PatternClassifier handles', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({
        handled: true,
        issues: [issue({ source: 'pattern', recommendation: 'install X' })],
      }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      expect(response.analysis.metadata.tierUsed).toBe('pattern');
      expect(response.analysis.issues[0]!.source).toBe('pattern');
      expect(llm.calls).toBe(0);
    });

    it('falls through to LLM tier when pattern misses', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm' })],
      }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.metadata.tierUsed).toBe('llm');
      expect(pattern.calls).toBe(1);
      expect(llm.calls).toBe(1);
    });

    it('skips pattern tier when options.forceFullAnalysis is true', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({
        handled: true,
        issues: [issue({ source: 'pattern' })],
      }));
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm' })],
      }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest({ options: { forceFullAnalysis: true } }));

      expect(pattern.calls).toBe(0);
      expect(llm.calls).toBe(1);
      expect(response.analysis.metadata.tierUsed).toBe('llm');
    });
  });

  describe('response assembly', () => {
    it('populates summary counts and primary recommendation from issues', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({
        handled: true,
        issues: [
          issue({ id: 'a', severity: 'error', recommendation: 'install lodash' }),
          issue({ id: 'b', severity: 'warning', recommendation: 'add PORT env' }),
        ],
      }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.summary.totalIssues).toBe(2);
      expect(response.analysis.summary.errors).toBe(1);
      expect(response.analysis.summary.warnings).toBe(1);
      expect(response.analysis.summary.primaryRecommendation).toBe('install lodash');
      expect(response.analysis.status).toBe('failing');
    });

    it('reports healthy status when zero issues returned', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.status).toBe('healthy');
      expect(response.analysis.summary.totalIssues).toBe(0);
    });

    it('captures analysisTimeMs via injected clock', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({
        handled: true,
        issues: [issue()],
      }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.metadata.analysisTimeMs).toBeGreaterThan(0);
    });

    it('records logsAnalyzed from CustomerLogsResponse.total', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 42 });
      const pattern = new FakeClassifier('pattern', async () => ({
        handled: true,
        issues: [issue()],
      }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.metadata.logsAnalyzed).toBe(42);
    });
  });

  describe('log fetch parameters', () => {
    it('forwards appId, target, since, and lines to CustomerLogsService', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest({ since: '2026-04-20T00:00:00Z', lines: 50 }));

      expect(logs.getLogs).toHaveBeenCalledWith({
        appId: 'app-123',
        target: 'publish',
        since: '2026-04-20T00:00:00Z',
        lines: 50,
      });
    });

    it('uses default line count when lines not provided', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest());

      const call = logs.getLogs.mock.calls[0]![0];
      expect(call.lines).toBe(200);
    });
  });

  describe('context propagation', () => {
    it('passes the request appId and target to the pattern classifier', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest({ appId: 'real-app-id' }));

      expect(pattern.lastContext).toEqual({ appId: 'real-app-id', target: 'publish' });
    });

    it('passes the request appId and target to the llm classifier', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest({ appId: 'real-app-id' }));

      expect(llm.lastContext).toEqual({ appId: 'real-app-id', target: 'publish' });
    });
  });

  describe('concurrency', () => {
    it('returns the same promise for concurrent calls on the same appId', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      let resolver!: (value: ClassifierResult) => void;
      const pattern = new FakeClassifier(
        'pattern',
        () => new Promise<ClassifierResult>((r) => { resolver = r; })
      );
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const p1 = svc.diagnose(makeRequest());
      const p2 = svc.diagnose(makeRequest());

      // Both requests should be in-flight; only one fetch should have happened.
      await new Promise((r) => setTimeout(r, 5));
      expect(logs.getLogs).toHaveBeenCalledTimes(1);
      expect(pattern.calls).toBe(1);

      resolver({ handled: true, issues: [issue()] });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(r2);
    });

    it('does not dedupe concurrent preview + publish on the same appId', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await Promise.all([
        svc.diagnose(makeRequest({ target: 'publish' })),
        svc.diagnose(makeRequest({ target: 'preview' })),
      ]);

      expect(logs.getLogs).toHaveBeenCalledTimes(2);
      expect(pattern.calls).toBe(2);
    });

    it('allows a new analysis after the first completes', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest());
      await svc.diagnose(makeRequest());

      expect(logs.getLogs).toHaveBeenCalledTimes(2);
      expect(pattern.calls).toBe(2);
    });
  });

  describe('classifier result propagation', () => {
    it('uses LLM-supplied status over severity-derived status', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm' })],
        status: 'unknown',
        primaryRecommendation: 'LLM synthesized headline',
      }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      if (!response.success) return;
      // Severity-derived would be 'failing' (one error-severity issue); LLM said 'unknown' — that must win.
      expect(response.analysis.status).toBe('unknown');
    });

    it('uses LLM-supplied primaryRecommendation instead of issues[0].recommendation', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm', recommendation: 'first-issue rec' })],
        status: 'failing',
        primaryRecommendation: 'LLM synthesized headline',
      }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      if (!response.success) return;
      expect(response.analysis.summary.primaryRecommendation).toBe('LLM synthesized headline');
    });

    it('falls back to severity-derived status and issues[0].recommendation when classifier omits the fields', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({
        handled: true,
        issues: [issue({ source: 'pattern', recommendation: 'install lodash' })],
      }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      if (!response.success) return;
      expect(response.analysis.status).toBe('failing');
      expect(response.analysis.summary.primaryRecommendation).toBe('install lodash');
    });
  });

  describe('pattern classifier resilience', () => {
    it('falls through to LLM when the pattern classifier throws', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => {
        throw new Error('regex callback exploded');
      });
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm', id: 'llm-fallback' })],
      }));

      const svc = new DiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      if (!response.success) return;
      expect(response.analysis.metadata.tierUsed).toBe('llm');
      expect(llm.calls).toBe(1);
      expect(response.analysis.issues[0]!.id).toBe('llm-fallback');
    });
  });
});
