import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaaSDiagnoseService } from '../PaaSDiagnoseService.js';
import { PatternClassifier } from '../classifiers/PatternClassifier.js';
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
    source: 'llm',
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

function makeAgentLogsService(
  logs: SanitizedLogEntry[],
  options?: { errorStage?: string; diagnoseSnapshotPath?: string; detectedPackageManager?: 'npm' }
): {
  getFailureLogs: ReturnType<typeof vi.fn>;
} {
  return {
    getFailureLogs: vi.fn().mockResolvedValue({
      logs,
      total: logs.length,
      source: logs.length > 0 ? 'import_job' : 'none',
      errorStage: options?.errorStage,
      diagnoseSnapshotPath: options?.diagnoseSnapshotPath,
      detectedPackageManager: options?.detectedPackageManager,
    }),
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

  function makeSvc(deps: {
    customerLogsService: ReturnType<typeof makeLogsService>;
    llmClassifier: FakeClassifier;
    agentOperationLogsService?: ReturnType<typeof makeAgentLogsService>;
    clock?: () => number;
  }): PaaSDiagnoseService {
    return new PaaSDiagnoseService({
      customerLogsService: deps.customerLogsService as never,
      llmClassifier: deps.llmClassifier,
      agentOperationLogsService: deps.agentOperationLogsService as never,
      clock: deps.clock ?? clock,
    });
  }

  beforeEach(() => {
    clockNow = 1000;
  });

  describe('log fetch failures', () => {
    it('returns APP_NOT_FOUND when CustomerLogsService reports missing app', async () => {
      const logs = makeLogsService({ success: false, logs: [], total: 0, error: 'App not found', code: 'APP_NOT_FOUND' });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('APP_NOT_FOUND');
      expect(llm.calls).toBe(0);
    });

    it('passes through SUPERVISOR_UNAVAILABLE', async () => {
      const logs = makeLogsService({ success: false, logs: [], total: 0, error: 'Supervisor down', code: 'SUPERVISOR_UNAVAILABLE' });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('SUPERVISOR_UNAVAILABLE');
    });

    it('maps unknown log-service codes to UNKNOWN', async () => {
      const logs = makeLogsService({ success: false, logs: [], total: 0, error: 'something', code: 'SOME_OTHER' });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
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
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.errorCode).toBe(expected);
    });
  });

  describe('log source selection', () => {
    it('includes "exec" source when target=preview so build/install output is seen for zip-upload triage', async () => {
      const logs = makeLogsService({ success: true, logs: [], total: 0 });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest({ target: 'preview' }));

      expect(logs.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({ sources: ['stdout', 'stderr', 'exec'] }),
      );
    });

    it('excludes "exec" source when target=publish since the publish container never runs /exec builds', async () => {
      const logs = makeLogsService({ success: true, logs: [], total: 0 });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest({ target: 'publish' }));

      expect(logs.getLogs).toHaveBeenCalledWith(
        expect.objectContaining({ sources: ['stdout', 'stderr'] }),
      );
    });
  });

  describe('tier selection', () => {
    it('always uses LLM classification when failure signals are present', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm' })],
      }));

      const svc = makeSvc({ customerLogsService: logs, llmClassifier: llm });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      expect(response.analysis.metadata.tierUsed).toBe('llm');
      expect(response.analysis.issues[0]!.source).toBe('llm');
      expect(llm.calls).toBe(1);
    });

    it('returns TIER_NOT_IMPLEMENTED for request.tier="embedding"', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = makeSvc({ customerLogsService: logs, llmClassifier: llm });
      const response = await svc.diagnose(makeRequest({ tier: 'embedding' }));

      expect(response.success).toBe(false);
      if (!response.success) {
        expect(response.errorCode).toBe('TIER_NOT_IMPLEMENTED');
      }
      expect(logs.getLogs).not.toHaveBeenCalled();
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
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
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
      expect(llm.calls).toBe(0);
    });

    it('proceeds to classifiers when a log has level="error"', async () => {
      const errLogs: SanitizedLogEntry[] = [
        { timestamp: '2026-04-20T10:30:45Z', source: 'stderr', message: 'boom', level: 'error' },
      ];
      const logs = makeLogsService({ success: true, logs: errLogs, total: 1 });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest());

      expect(llm.calls).toBe(1);
    });

    it('proceeds to classifiers when message matches error token regex even at info level', async () => {
      const infoWithError: SanitizedLogEntry[] = [
        { timestamp: '2026-04-20T10:30:45Z', source: 'stdout', message: 'FATAL: cannot bind port', level: 'info' },
      ];
      const logs = makeLogsService({ success: true, logs: infoWithError, total: 1 });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest());

      expect(llm.calls).toBe(1);
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
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.status).not.toBe('noerrlog');
      expect(llm.calls).toBe(1);
    });

    it('returns noerrlog when supervisor returns zero log lines', async () => {
      // Most common production trigger for early-exit: the supervisor's log
      // window is empty (container just started, or nothing has been written
      // in the last 3h). .some() on [] is false, so we short-circuit.
      const logs = makeLogsService({ success: true, logs: [], total: 0 });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      expect(response.analysis.status).toBe('noerrlog');
      expect(llm.calls).toBe(0);
    });

    it('does NOT early-exit on benign words like "fallback" (word boundary on fail)', async () => {
      const benign: SanitizedLogEntry[] = [
        { timestamp: '2026-04-20T10:30:45Z', source: 'stdout', message: 'Registered fallback handler', level: 'info' },
      ];
      const logs = makeLogsService({ success: true, logs: benign, total: 1 });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      // "fallback" must NOT trigger the failure regex — we should see early exit.
      expect(response.analysis.status).toBe('noerrlog');
      expect(llm.calls).toBe(0);
    });
  });

  describe('agent vs customer log source', () => {
    it('uses agent import logs for pipeline failures even when customer logs are clean', async () => {
      const infoLogs: SanitizedLogEntry[] = [
        { timestamp: '2026-04-20T10:30:45Z', source: 'stdout', message: 'Listening on port 3000', level: 'info' },
      ];
      const customerLogs = makeLogsService({ success: true, logs: infoLogs, total: 1 });
      const agentLogs = makeAgentLogsService(
        [
          { timestamp: '2026-04-20T10:31:00Z', source: 'stderr', message: 'npm ERR! code ENOENT', level: 'error' },
        ],
        { errorStage: 'installing' }
      );
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = makeSvc({
        customerLogsService: customerLogs,
        agentOperationLogsService: agentLogs,
        llmClassifier: llm,
      });
      const response = await svc.diagnose(makeRequest());

      expect(agentLogs.getFailureLogs).toHaveBeenCalled();
      expect(response.analysis.status).not.toBe('noerrlog');
      expect(llm.calls).toBe(1);
      expect(llm.lastLogs?.some((l) => l.message.includes('npm ERR!'))).toBe(true);
    });

    it('prefers agent validation failure over stale customer build stderr', async () => {
      const customerLogs = makeLogsService({
        success: true,
        logs: [
          { timestamp: '2026-04-20T10:30:45Z', source: 'stderr', message: 'npm ERR! old build failed', level: 'error' },
        ],
        total: 1,
      });
      const agentLogs = makeAgentLogsService(
        [
          {
            timestamp: '2026-04-20T10:31:00Z',
            source: 'stderr',
            message: '[agent/import:validation] PACKAGE_JSON_NOT_FOUND: package.json not found',
            level: 'error',
          },
        ],
        { errorStage: 'validating' }
      );
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = makeSvc({
        customerLogsService: customerLogs,
        agentOperationLogsService: agentLogs,
        llmClassifier: llm,
      });
      await svc.diagnose(makeRequest());

      expect(agentLogs.getFailureLogs).toHaveBeenCalled();
      expect(llm.lastLogs?.some((l) => l.message.includes('PACKAGE_JSON_NOT_FOUND'))).toBe(true);
      expect(llm.lastLogs?.some((l) => l.message.includes('old build failed'))).toBe(false);
    });

    it('uses agent build logs instead of customer stderr for import build failures', async () => {
      const customerLogs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const agentLogs = makeAgentLogsService(
        [
          { timestamp: '2026-04-20T10:31:00Z', source: 'stderr', message: '[agent/import:build] Build failed', level: 'error' },
        ],
        { errorStage: 'building' }
      );
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = makeSvc({
        customerLogsService: customerLogs,
        agentOperationLogsService: agentLogs,
        llmClassifier: llm,
      });
      await svc.diagnose(makeRequest());

      expect(agentLogs.getFailureLogs).toHaveBeenCalled();
      expect(llm.lastLogs?.some((l) => l.message.includes('[agent/import:build]'))).toBe(true);
      expect(llm.lastLogs?.some((l) => l.message === 'boom')).toBe(false);
    });

    it('uses customer logs for runtime failures when import failed at restarting', async () => {
      const customerLogs = makeLogsService({
        success: true,
        logs: [
          { timestamp: '2026-04-20T10:30:45Z', source: 'stderr', message: 'TypeError: Cannot read property x', level: 'error' },
        ],
        total: 1,
      });
      const agentLogs = makeAgentLogsService(
        [
          {
            timestamp: '2026-04-20T10:31:00Z',
            source: 'stderr',
            message: '[agent/import] Dev server failed to start',
            level: 'error',
          },
        ],
        { errorStage: 'restarting' }
      );
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = makeSvc({
        customerLogsService: customerLogs,
        agentOperationLogsService: agentLogs,
        llmClassifier: llm,
      });
      await svc.diagnose(makeRequest());

      expect(llm.lastLogs?.some((l) => l.message.includes('TypeError'))).toBe(true);
      expect(llm.lastLogs?.some((l) => l.message.includes('Dev server failed'))).toBe(false);
    });

    it('returns noerrlog when both customer and agent logs lack failure signals', async () => {
      const customerLogs = makeLogsService({ success: true, logs: [], total: 0 });
      const agentLogs = makeAgentLogsService([]);
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = makeSvc({
        customerLogsService: customerLogs,
        agentOperationLogsService: agentLogs,
        llmClassifier: llm,
      });
      const response = await svc.diagnose(makeRequest());

      expect(agentLogs.getFailureLogs).toHaveBeenCalled();
      expect(response.analysis.status).toBe('noerrlog');
      expect(response.analysis.issues[0]!.message).toContain('Agent import/build history was also checked');
      expect(llm.calls).toBe(0);
    });
  });

  describe('response assembly', () => {
    it('populates summary counts and primary recommendation from issues', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [
          issue({ id: 'a', severity: 'error', recommendation: 'install lodash', source: 'llm' }),
          issue({ id: 'b', severity: 'warning', recommendation: 'add PORT env', source: 'llm' }),
        ],
      }));

      const svc = makeSvc({ customerLogsService: logs, llmClassifier: llm });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.summary.totalIssues).toBe(2);
      expect(response.analysis.summary.errors).toBe(1);
      expect(response.analysis.summary.warnings).toBe(1);
      expect(response.analysis.summary.primaryRecommendation).toBe('install lodash');
      expect(response.analysis.status).toBe('failing');
    });

    it('reports healthy status when zero issues returned', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = makeSvc({ customerLogsService: logs, llmClassifier: llm });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.status).toBe('healthy');
      expect(response.analysis.summary.totalIssues).toBe(0);
    });

    it('captures analysisTimeMs via injected clock', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = makeSvc({ customerLogsService: logs, llmClassifier: llm });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.metadata.analysisTimeMs).toBeGreaterThan(0);
    });

    it('records logsAnalyzed from CustomerLogsResponse.total', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 42 });
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = makeSvc({ customerLogsService: logs, llmClassifier: llm });
      const response = await svc.diagnose(makeRequest());

      expect(response.analysis.metadata.logsAnalyzed).toBe(42);
    });
  });

  describe('log fetch parameters (internal defaults)', () => {
    it('uses 500 lines and a 3-hour-ago ISO since when fetching logs', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
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
    it('passes the request appId and target to the llm classifier', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue({ source: 'llm' })] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest({ appId: 'real-app-id' }));

      expect(llm.lastContext).toMatchObject({
        appId: 'real-app-id',
        target: 'publish',
        logSource: 'customer',
      });
    });
  });

  describe('concurrency', () => {
    it('rejects a concurrent call on the same appId + same target with ANOTHER_DIAGNOSE_IN_FLIGHT', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      let resolver!: (value: ClassifierResult) => void;
      const llm = new FakeClassifier(
        'llm',
        () => new Promise<ClassifierResult>((r) => { resolver = r; })
      );

      const svc = makeSvc({ customerLogsService: logs, llmClassifier: llm });
      // `diagnose()` has no `await` before `inFlight.set`, so call-1's entry is
      // already present by the time the Promise is returned to us — no sleep needed.
      const first = svc.diagnose(makeRequest());
      const second = await svc.diagnose(makeRequest());

      expect(second.success).toBe(false);
      if (!second.success) {
        expect(second.errorCode).toBe('ANOTHER_DIAGNOSE_IN_FLIGHT');
      }
      expect(logs.getLogs).toHaveBeenCalledTimes(1);
      expect(llm.calls).toBe(1);

      resolver({ handled: true, issues: [issue()] });
      const firstResult = await first;
      expect(firstResult.success).toBe(true);
    });

    it('rejects a concurrent preview call when publish is in-flight on the same appId', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      let resolver!: (value: ClassifierResult) => void;
      const llm = new FakeClassifier(
        'llm',
        () => new Promise<ClassifierResult>((r) => { resolver = r; })
      );

      const svc = makeSvc({ customerLogsService: logs, llmClassifier: llm });
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
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      await svc.diagnose(makeRequest());
      await svc.diagnose(makeRequest());

      expect(logs.getLogs).toHaveBeenCalledTimes(2);
      expect(llm.calls).toBe(2);
    });

    it('does not block a different appId while one is in-flight', async () => {
      // Guards the inFlight map keying. diagnose() has no `await` before
      // `inFlight.set`, so app-123's entry is already present when app-456's
      // entry-check runs. If the map were keyed by target (or globally), this
      // would return ANOTHER_DIAGNOSE_IN_FLIGHT; keyed by appId, both succeed.
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      const first = svc.diagnose(makeRequest({ appId: 'app-123' }));
      const second = svc.diagnose(makeRequest({ appId: 'app-456' }));

      const [r1, r2] = await Promise.all([first, second]);
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      expect(llm.calls).toBe(2);
    });

    it('releases inFlight when log fetch fails, allowing a retry on the same appId', async () => {
      // Guards the .finally() cleanup contract — if someone refactored to
      // .then(cleanup).catch(throw), the second call would erroneously see
      // ANOTHER_DIAGNOSE_IN_FLIGHT.
      const logs = makeLogsService({ success: false, logs: [], total: 0, error: 'App not found', code: 'APP_NOT_FOUND' });
const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [] }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
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
const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm' })],
        status: 'unknown',
        primaryRecommendation: 'LLM synthesized headline',
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      if (!response.success) return;
      // Severity-derived would be 'failing' (one error-severity issue); LLM said 'unknown' — that must win.
      expect(response.analysis.status).toBe('unknown');
    });

    it('uses LLM-supplied primaryRecommendation instead of issues[0].recommendation', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm', recommendation: 'first-issue rec' })],
        status: 'failing',
        primaryRecommendation: 'LLM synthesized headline',
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      if (!response.success) return;
      expect(response.analysis.summary.primaryRecommendation).toBe('LLM synthesized headline');
    });

    it('falls back to severity-derived status and issues[0].recommendation when classifier omits the fields', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm', recommendation: 'install lodash' })],
      }));

      const svc = makeSvc({ customerLogsService: logs, llmClassifier: llm });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      if (!response.success) return;
      expect(response.analysis.status).toBe('failing');
      expect(response.analysis.summary.primaryRecommendation).toBe('install lodash');
    });
  });

  describe('llm classifier resilience', () => {
    it('surfaces LLM_FAILURE when the LLM classifier unexpectedly throws', async () => {
      // LlmClassifier's contract is never-throw; this test guards the
      // callsite wrapper so a broken double or refactor bug becomes a
      // structured LLM_FAILURE instead of 500 UNKNOWN.
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
const llm = new FakeClassifier('llm', async () => {
        throw new Error('classifier invariant violated');
      });

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
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
const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        degraded: true,
        issues: [issue({ source: 'llm', id: 'llm-failure', severity: 'warning', confidence: 0, message: 'Unable to analyze logs automatically — the LLM tier failed.' })],
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
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
const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        degraded: true,
        issues: [issue({ source: 'llm', id: 'llm-prompt-missing', severity: 'warning', confidence: 0, message: 'Unable to analyze logs — an analyzer prompt file is missing.' })],
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
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
const llm = new FakeClassifier('llm', async () => ({
        handled: true,
        issues: [issue({ source: 'llm', id: 'missing-dependency' })],
      }));

      const svc = new PaaSDiagnoseService({ customerLogsService: logs as never, llmClassifier: llm, clock });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      expect(findHitEvent(infoSpy)).toMatchObject({ llmFailure: false, issueCount: 1 });
      infoSpy.mockRestore();
    });
  });

  describe('pattern tier and project context', () => {
    it('short-circuits LLM when pattern classifier matches', async () => {
      const logs = makeLogsService({
        success: true,
        logs: [
          {
            timestamp: '2026-04-20T10:30:45Z',
            source: 'stderr',
            message: "Error: Cannot find module 'lodash'",
            level: 'error',
          },
        ],
        total: 1,
      });
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue()] }));
      const pattern = new PatternClassifier();

      const svc = new PaaSDiagnoseService({
        customerLogsService: logs as never,
        patternClassifier: pattern,
        llmClassifier: llm,
        clock,
      });
      const response = await svc.diagnose(makeRequest());

      expect(response.success).toBe(true);
      expect(response.analysis.metadata.tierUsed).toBe('pattern');
      expect(llm.calls).toBe(0);
      expect(response.analysis.summary.primaryRecommendation).toContain('npm install lodash');
    });

    it('passes snapshot path and project context into LLM classifier', async () => {
      const logs = makeLogsService({ success: true, logs: makeLogs(), total: 1 });
      const agentLogs = makeAgentLogsService(makeLogs(), {
        errorStage: 'building',
        diagnoseSnapshotPath: '/tmp/snapshots/job-1',
        detectedPackageManager: 'npm',
      });
      const llm = new FakeClassifier('llm', async () => ({ handled: true, issues: [issue()] }));
      const gather = vi.fn().mockResolvedValue({
        files: [],
        projectContextText: '### package.json\n```\n{}\n```',
        contextSource: 'snapshot' as const,
        filesIncluded: 1,
      });

      const svc = new PaaSDiagnoseService({
        customerLogsService: logs as never,
        agentOperationLogsService: agentLogs as never,
        llmClassifier: llm,
        diagnoseContextService: { gather },
        clock,
      });
      await svc.diagnose(makeRequest());

      expect(gather).toHaveBeenCalledWith(
        expect.objectContaining({
          snapshotPath: '/tmp/snapshots/job-1',
          logSource: 'import_job',
        })
      );
      expect(llm.lastContext?.contextSource).toBe('snapshot');
      if (llm.lastContext?.contextSource === 'snapshot') {
        expect(llm.lastContext.snapshotPath).toBe('/tmp/snapshots/job-1');
      }
      expect(llm.lastContext?.projectContextText).toContain('package.json');
    });
  });
});
