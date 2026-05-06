import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaaSDiagnoseService } from '../PaaSDiagnoseService.js';
import { Logger } from '../../../logging/index.js';
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

describe('PaaSDiagnoseService', () => {
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('SUPERVISOR_UNAVAILABLE');
    });

    it('maps unknown log-service codes to UNKNOWN', async () => {
      const logs = makeLogsService({ success: false, logs: [], total: 0, error: 'something', code: 'SOME_OTHER' });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.metadata.tierUsed).toBe('llm');
      expect(pattern.calls).toBe(1);
      expect(llm.calls).toBe(1);
    });

    it('skips pattern tier when request.tier is "llm"', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({
        handled: true,
        issues: [issue({ source: 'pattern' })],
      }));
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm' })],
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest({ tier: 'llm' }));

      expect(pattern.calls).toBe(0);
      expect(llm.calls).toBe(1);
      expect(response.analysis.metadata.tierUsed).toBe('llm');
    });

    it('returns TIER_NOT_IMPLEMENTED for request.tier="embedding"', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest({ tier: 'embedding' }));

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.errorCode).toBe('TIER_NOT_IMPLEMENTED');
      }
      expect(logs.getLogs).not.toHaveBeenCalled();
      expect(pattern.calls).toBe(0);
      expect(llm.calls).toBe(0);
    });
  });

  describe('early exit (no failure signal)', () => {
    it('returns noerrlog status and skips classifiers when no logs match failure signals', async () => {
      const infoLogs: SanitizedLogEntry[] = [
        { timestamp: '2026-04-20T10:30:45Z', source: 'stdout', message: 'Listening on port 3000', level: 'info' },
        { timestamp: '2026-04-20T10:30:46Z', source: 'stdout', message: 'Ready to serve requests', level: 'info' },
      ];
      const logs = makeLogsService({ success: true, logs: infoLogs, total: 2 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      expect(response.analysis.status).toBe('noerrlog');
      expect(response.analysis.issues[0]!.id).toBe('no-failure-detected');
      // Summary counters must stay consistent with issues[].
      expect(response.analysis.summary.totalIssues).toBe(response.analysis.issues.length);
      expect(response.analysis.summary.warnings).toBe(
        response.analysis.issues.filter((i) => i.severity === 'warning').length,
      );
      expect(response.analysis.summary.errors).toBe(
        response.analysis.issues.filter((i) => i.severity === 'error').length,
      );
      expect(pattern.calls).toBe(0);
      expect(llm.calls).toBe(0);
    });

    it('proceeds to classifiers when a log has level="error"', async () => {
      const errLogs: SanitizedLogEntry[] = [
        { timestamp: '2026-04-20T10:30:45Z', source: 'stderr', message: 'boom', level: 'error' },
      ];
      const logs = makeLogsService({ success: true, logs: errLogs, total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest());

      expect(pattern.calls).toBe(1);
    });

    it('proceeds to classifiers when message matches error token regex even at info level', async () => {
      const infoWithError: SanitizedLogEntry[] = [
        { timestamp: '2026-04-20T10:30:45Z', source: 'stdout', message: 'FATAL: cannot bind port', level: 'info' },
      ];
      const logs = makeLogsService({ success: true, logs: infoWithError, total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest());

      expect(pattern.calls).toBe(1);
    });

    it.each([
      'TypeError: Cannot read properties of undefined',
      'ReferenceError: foo is not defined',
      'SyntaxError: Unexpected token',
      'RangeError: Maximum call stack size exceeded',
      'URIError: URI malformed',
      'Error [ERR_MODULE_NOT_FOUND]: Cannot find package foo',
      'Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import not supported',
    ])('proceeds to classifiers on compound Node error "%s" at info level', async (message) => {
      const compound: SanitizedLogEntry[] = [
        { timestamp: '2026-04-20T10:30:45Z', source: 'stdout', message, level: 'info' },
      ];
      const logs = makeLogsService({ success: true, logs: compound, total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.status).not.toBe('noerrlog');
      expect(pattern.calls).toBe(1);
    });

    it('returns noerrlog when supervisor returns zero log lines', async () => {
      // Most common production trigger for early-exit: the supervisor's log
      // window is empty (container just started, or nothing has been written
      // in the last 3h). .some() on [] is false, so we short-circuit.
      const logs = makeLogsService({ success: true, logs: [], total: 0 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      expect(response.analysis.status).toBe('noerrlog');
      expect(pattern.calls).toBe(0);
      expect(llm.calls).toBe(0);
    });

    it('does NOT early-exit on benign words like "fallback" (word boundary on fail)', async () => {
      const benign: SanitizedLogEntry[] = [
        { timestamp: '2026-04-20T10:30:45Z', source: 'stdout', message: 'Registered fallback handler', level: 'info' },
      ];
      const logs = makeLogsService({ success: true, logs: benign, total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      // "fallback" must NOT trigger the failure regex — we should see early exit.
      expect(response.analysis.status).toBe('noerrlog');
      expect(pattern.calls).toBe(0);
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.metadata.logsAnalyzed).toBe(42);
    });
  });

  describe('log fetch parameters (internal defaults)', () => {
    it('uses 500 lines and a 3-hour-ago ISO since when fetching logs', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest());

      const call = logs.getLogs.mock.calls[0]![0];
      expect(call.appId).toBe('app-123');
      expect(call.target).toBe('publish');
      expect(call.lines).toBe(500);
      // since = startedAt - 3h; startedAt comes from our injected clock (first tick = 1010ms).
      // 1010 - 3*3600*1000 = -10798990 → Date(-10798990).toISOString() in 1969.
      const expectedMs = 1010 - 3 * 60 * 60 * 1000;
      expect(call.since).toBe(new Date(expectedMs).toISOString());
    });
  });

  describe('context propagation', () => {
    it('passes the request appId and target to the pattern classifier', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest({ appId: 'real-app-id' }));

      expect(pattern.lastContext).toEqual({ appId: 'real-app-id', target: 'publish' });
    });

    it('passes the request appId and target to the llm classifier', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest({ appId: 'real-app-id' }));

      expect(llm.lastContext).toEqual({ appId: 'real-app-id', target: 'publish' });
    });
  });

  describe('concurrency', () => {
    it('rejects a concurrent call on the same appId + same target with ANOTHER_DIAGNOSE_IN_FLIGHT', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      let resolver!: (value: ClassifierResult) => void;
      const pattern = new FakeClassifier(
        'pattern',
        () => new Promise<ClassifierResult>((r) => { resolver = r; })
      );
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      // `diagnose()` has no `await` before `inFlight.set`, so call-1's entry is
      // already present by the time the Promise is returned to us — no sleep needed.
      const first = svc.diagnose(makeRequest());
      const second = await svc.diagnose(makeRequest());

      expect(second.success).toBe(false);
      if (!second.success) {
        expect(second.errorCode).toBe('ANOTHER_DIAGNOSE_IN_FLIGHT');
      }
      expect(logs.getLogs).toHaveBeenCalledTimes(1);
      expect(pattern.calls).toBe(1);

      resolver({ handled: true, issues: [issue()] });
      const firstResult = await first;
      expect(firstResult.success).toBe(true);
    });

    it('rejects a concurrent preview call when publish is in-flight on the same appId', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      let resolver!: (value: ClassifierResult) => void;
      const pattern = new FakeClassifier(
        'pattern',
        () => new Promise<ClassifierResult>((r) => { resolver = r; })
      );
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const first = svc.diagnose(makeRequest({ target: 'publish' }));
      const second = await svc.diagnose(makeRequest({ target: 'preview' }));

      expect(second.success).toBe(false);
      if (!second.success) {
        expect(second.errorCode).toBe('ANOTHER_DIAGNOSE_IN_FLIGHT');
        expect(second.error).toContain('publish');
      }
      expect(logs.getLogs).toHaveBeenCalledTimes(1);

      resolver({ handled: true, issues: [issue()] });
      await first;
    });

    it('allows a new analysis after the first completes', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest());
      await svc.diagnose(makeRequest());

      expect(logs.getLogs).toHaveBeenCalledTimes(2);
      expect(pattern.calls).toBe(2);
    });

    it('does not block a different appId while one is in-flight', async () => {
      // Guards the inFlight map keying. diagnose() has no `await` before
      // `inFlight.set`, so app-123's entry is already present when app-456's
      // entry-check runs. If the map were keyed by target (or globally), this
      // would return ANOTHER_DIAGNOSE_IN_FLIGHT; keyed by appId, both succeed.
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [issue()] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const first = svc.diagnose(makeRequest({ appId: 'app-123' }));
      const second = svc.diagnose(makeRequest({ appId: 'app-456' }));

      const [r1, r2] = await Promise.all([first, second]);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(pattern.calls).toBe(2);
    });

    it('releases inFlight when log fetch fails, allowing a retry on the same appId', async () => {
      // Guards the .finally() cleanup contract — if someone refactored to
      // .then(cleanup).catch(throw), the second call would erroneously see
      // ANOTHER_DIAGNOSE_IN_FLIGHT.
      const logs = makeLogsService({ success: false, logs: [], total: 0, error: 'App not found', code: 'APP_NOT_FOUND' });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const first = await svc.diagnose(makeRequest());
      expect(first.success).toBe(false);
      if (!first.success) expect(first.errorCode).toBe('APP_NOT_FOUND');

      const second = await svc.diagnose(makeRequest());
      expect(second.success).toBe(false);
      if (!second.success) {
        // Must be APP_NOT_FOUND again, NOT ANOTHER_DIAGNOSE_IN_FLIGHT.
        expect(second.errorCode).toBe('APP_NOT_FOUND');
      }
      expect(logs.getLogs).toHaveBeenCalledTimes(2);
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
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

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      if (!response.success) return;
      expect(response.analysis.status).toBe('failing');
      expect(response.analysis.summary.primaryRecommendation).toBe('install lodash');
    });
  });

  describe('pattern classifier resilience', () => {
    it('falls through to LLM when pattern returns handled=true with no issues', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: true, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm', id: 'llm-fallback' })],
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      if (!response.success) return;
      expect(pattern.calls).toBe(1);
      expect(llm.calls).toBe(1);
      expect(response.analysis.metadata.tierUsed).toBe('llm');
      expect(response.analysis.issues[0]!.id).toBe('llm-fallback');
    });

    it('falls through to LLM when the pattern classifier throws', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => {
        throw new Error('regex callback exploded');
      });
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm', id: 'llm-fallback' })],
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      if (!response.success) return;
      expect(response.analysis.metadata.tierUsed).toBe('llm');
      expect(llm.calls).toBe(1);
      expect(response.analysis.issues[0]!.id).toBe('llm-fallback');
    });

    it('surfaces LLM_FAILURE when the LLM classifier unexpectedly throws', async () => {
      // LlmClassifier's contract is never-throw; this test guards the
      // callsite wrapper so a broken double or refactor bug becomes a
      // structured LLM_FAILURE instead of 500 UNKNOWN.
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => {
        throw new Error('classifier invariant violated');
      });

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(false);
      if (response.success === false) {
        expect(response.errorCode).toBe('LLM_FAILURE');
        expect(response.analysis.issues[0]!.id).toBe('llm-failure');
        expect(response.analysis.metadata.tierUsed).toBe('llm');
      }
    });
  });

  describe('llm tier degradation logging', () => {
    function findHitEvent(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> | undefined {
      const call = spy.mock.calls.find(([event]) => event === 'diagnose.tier.llm.hit');
      return call?.[1] as Record<string, unknown> | undefined;
    }

    it('returns LLM_FAILURE and logs llmFailure=true when LLM classifier reports degraded (llm-failure)', async () => {
      const infoSpy = vi.spyOn(Logger.prototype, 'info');
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        degraded: true,
        issues: [issue({ source: 'llm', id: 'llm-failure', severity: 'warning', confidence: 0, message: 'Unable to analyze logs automatically — the LLM tier failed.' })],
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(false);
      if (response.success === false) {
        expect(response.errorCode).toBe('LLM_FAILURE');
        expect(response.error).toMatch(/LLM tier failed/i);
        expect(response.analysis.issues[0]!.id).toBe('llm-failure');
        expect(response.analysis.metadata.tierUsed).toBe('llm');
      }
      expect(findHitEvent(infoSpy)).toMatchObject({ llmFailure: true, issueCount: 1 });
      infoSpy.mockRestore();
    });

    it('returns LLM_FAILURE and logs llmFailure=true when LLM classifier reports degraded (llm-prompt-missing)', async () => {
      const infoSpy = vi.spyOn(Logger.prototype, 'info');
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        degraded: true,
        issues: [issue({ source: 'llm', id: 'llm-prompt-missing', severity: 'warning', confidence: 0, message: 'Unable to analyze logs — an analyzer prompt file is missing.' })],
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(false);
      if (response.success === false) {
        expect(response.errorCode).toBe('LLM_FAILURE');
        expect(response.error).toMatch(/prompt file is missing/i);
        expect(response.analysis.issues[0]!.id).toBe('llm-prompt-missing');
      }
      expect(findHitEvent(infoSpy)).toMatchObject({ llmFailure: true, issueCount: 1 });
      infoSpy.mockRestore();
    });

    it('returns success=true and logs llmFailure=false for a normal LLM issue', async () => {
      const infoSpy = vi.spyOn(Logger.prototype, 'info');
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const pattern = new FakeClassifier('pattern', async () => ({ handled: false, issues: [] }));
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm', id: 'missing-dependency' })],
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, patternClassifier: pattern, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      expect(findHitEvent(infoSpy)).toMatchObject({ llmFailure: false, issueCount: 1 });
      infoSpy.mockRestore();
    });
  });
});
