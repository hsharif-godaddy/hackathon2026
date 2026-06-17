import { describe, it, expect, vi } from 'vitest';

import {
  PaaSAutoFixService,
  type PaaSAutoFixServiceDeps,
  type AutoFixGitTool,
} from '../PaaSAutoFixService.js';
import type { ActionExecutor, ActionExecutionResult } from '../ActionExecutor.js';
import type { AgentDrivenFixer, AgentFixResult } from '../AgentDrivenFixer.js';
import type { DiagnoseService } from '../../diagnose/DiagnoseService.js';
import type { Analysis, DiagnoseAction, DiagnoseResponse, Issue } from '../../diagnose/types.js';
import type { AutoFixRequest } from '../types.js';

const APP_ID = 'app-abc1234567';

function issue(overrides: Partial<Issue> & { actions?: DiagnoseAction[] } = {}): Issue {
  return {
    id: 'iss-1',
    category: 'Missing Dependency',
    severity: 'error',
    message: 'lodash missing',
    recommendation: 'install lodash',
    confidence: 90,
    source: 'llm',
    ...overrides,
  };
}

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    status: 'failing',
    issues: [],
    summary: { totalIssues: 0, errors: 0, warnings: 0, primaryRecommendation: 'rec' },
    metadata: { logsAnalyzed: 1, tierUsed: 'llm', analysisTimeMs: 1 },
    ...overrides,
  };
}

function makeDiagnoseService(
  responses: DiagnoseResponse[]
): { diagnose: ReturnType<typeof vi.fn> } {
  let i = 0;
  return {
    diagnose: vi.fn().mockImplementation(() => {
      const r = responses[i] ?? responses[responses.length - 1];
      i += 1;
      return Promise.resolve(r);
    }),
  };
}

function makeExecutor(result: ActionExecutionResult): ActionExecutor {
  return { execute: vi.fn().mockResolvedValue(result) };
}

function makeGitToolFactory(): {
  factory: PaaSAutoFixServiceDeps['gitToolFactory'];
  ops: Array<{ op: string; opts: unknown }>;
} {
  const ops: Array<{ op: string; opts: unknown }> = [];
  const factory: PaaSAutoFixServiceDeps['gitToolFactory'] = (): AutoFixGitTool => ({
    executeGitOperation: vi
      .fn()
      .mockImplementation(async (_path: string, opts: { operation: string }) => {
        ops.push({ op: opts.operation, opts });
        return { success: true };
      }),
  });
  return { factory, ops };
}

function buildService(
  deps: Partial<PaaSAutoFixServiceDeps> & {
    diagnoseService: DiagnoseService;
    actionExecutor: ActionExecutor;
  }
): PaaSAutoFixService {
  return new PaaSAutoFixService({
    workspaceFactory: () => null,
    gitToolFactory: (): AutoFixGitTool => ({
      executeGitOperation: vi.fn().mockResolvedValue({ success: true }),
    }),
    appRestart: { restartDevServer: vi.fn().mockResolvedValue({ success: true }) },
    verifyDelayMs: 0,
    ...deps,
  });
}

const REQ: AutoFixRequest = { appId: APP_ID, target: 'preview' };

describe('PaaSAutoFixService', () => {
  it('returns diagnose failure as-is when pre-fix diagnose fails', async () => {
    const diagnose = makeDiagnoseService([
      {
        success: false,
        error: 'logs unavailable',
        errorCode: 'SUPERVISOR_UNAVAILABLE',
        analysis: analysis({ status: 'unknown' }),
      },
    ]);
    const executor = makeExecutor({ success: true, applied: [] });
    const svc = buildService({ diagnoseService: diagnose as unknown as DiagnoseService, actionExecutor: executor });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('SUPERVISOR_UNAVAILABLE');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('returns success with no actions when pre-fix is healthy', async () => {
    const diagnose = makeDiagnoseService([
      { success: true, analysis: analysis({ status: 'healthy' }) },
    ]);
    const executor = makeExecutor({ success: true, applied: [] });
    const svc = buildService({ diagnoseService: diagnose as unknown as DiagnoseService, actionExecutor: executor });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(true);
    expect((res as { appliedActions: unknown[] }).appliedActions).toEqual([]);
    expect(executor.execute).not.toHaveBeenCalled();
    // Only the pre-fix diagnose runs — no verify needed.
    expect(diagnose.diagnose).toHaveBeenCalledTimes(1);
  });

  it('returns success with no actions when pre-fix is noerrlog', async () => {
    const diagnose = makeDiagnoseService([
      { success: true, analysis: analysis({ status: 'noerrlog' }) },
    ]);
    const executor = makeExecutor({ success: true, applied: [] });
    const svc = buildService({ diagnoseService: diagnose as unknown as DiagnoseService, actionExecutor: executor });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(true);
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('returns NO_ACTIONABLE_FIXES when failing analysis has no actions', async () => {
    const failing = analysis({
      status: 'failing',
      issues: [issue({ actions: [] })],
    });
    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({ success: true, applied: [] });
    const svc = buildService({ diagnoseService: diagnose as unknown as DiagnoseService, actionExecutor: executor });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('NO_ACTIONABLE_FIXES');
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('dryRun returns planned skipped actions and never invokes the executor', async () => {
    const action: DiagnoseAction = { type: 'command', command: 'npm install lodash' };
    const failing = analysis({
      status: 'failing',
      issues: [issue({ actions: [action] })],
    });
    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({ success: true, applied: [] });
    const restart = { restartDevServer: vi.fn() };
    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      appRestart: restart,
    });

    const res = await svc.autoFix({ ...REQ, dryRun: true });

    expect(res.success).toBe(true);
    const r = res as { appliedActions: Array<{ status: string }> };
    expect(r.appliedActions).toHaveLength(1);
    expect(r.appliedActions[0]?.status).toBe('skipped');
    expect(executor.execute).not.toHaveBeenCalled();
    expect(restart.restartDevServer).not.toHaveBeenCalled();
    // No verification call either.
    expect(diagnose.diagnose).toHaveBeenCalledTimes(1);
  });

  it('happy path: applies actions, commits, restarts, verifies healthy', async () => {
    const action: DiagnoseAction = { type: 'command', command: 'npm install lodash' };
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [action] })] });
    const healthy = analysis({ status: 'healthy', issues: [] });

    const diagnose = makeDiagnoseService([
      { success: true, analysis: failing },
      { success: true, analysis: healthy },
    ]);
    const executor = makeExecutor({
      success: true,
      applied: [{ action, status: 'applied' }],
    });
    const git = makeGitToolFactory();
    const restart = { restartDevServer: vi.fn().mockResolvedValue({ success: true }) };

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      gitToolFactory: git.factory,
      appRestart: restart,
    });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(true);
    const r = res as {
      appliedActions: unknown[];
      restarted: boolean;
      postFixAnalysis: Analysis;
    };
    expect(r.appliedActions).toHaveLength(1);
    expect(r.restarted).toBe(true);
    expect(r.postFixAnalysis.status).toBe('healthy');
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(restart.restartDevServer).toHaveBeenCalledWith(APP_ID);
    expect(diagnose.diagnose).toHaveBeenCalledTimes(2);
    // Verify diagnose is scoped to post-restart logs; pre-fix uses the full
    // 3-hour window. Without this scope, verify re-reads the pre-fix errors.
    const [preFixCall, verifyCall] = diagnose.diagnose.mock.calls;
    expect(preFixCall[0]).not.toHaveProperty('since');
    expect(typeof verifyCall[0].since).toBe('string');
    // Commit pair: add then commit. No reset/clean (no rollback).
    expect(git.ops.map((o) => o.op)).toEqual(['add', 'commit']);
  });

  it('rolls back and returns APPLY_FAILED when executor fails', async () => {
    const action: DiagnoseAction = { type: 'command', command: 'npm test' };
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [action] })] });

    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({
      success: false,
      applied: [{ action, status: 'failed', error: 'exit 1' }],
    });
    const git = makeGitToolFactory();
    const restart = { restartDevServer: vi.fn() };

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      gitToolFactory: git.factory,
      appRestart: restart,
    });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('APPLY_FAILED');
    // Rollback ran; restart and verify did not.
    expect(git.ops.map((o) => o.op)).toEqual(['reset', 'clean']);
    expect(restart.restartDevServer).not.toHaveBeenCalled();
    expect(diagnose.diagnose).toHaveBeenCalledTimes(1);
  });

  it('does not claim a clean rollback when rollback itself fails', async () => {
    const action: DiagnoseAction = { type: 'command', command: 'npm test' };
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [action] })] });

    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({
      success: false,
      applied: [{ action, status: 'failed', error: 'exit 1' }],
    });
    // `git reset --hard` refuses → the rollback did NOT land.
    const gitToolFactory: PaaSAutoFixServiceDeps['gitToolFactory'] = (): AutoFixGitTool => ({
      executeGitOperation: vi
        .fn()
        .mockImplementation(async (_path: string, opts: { operation: string }) =>
          opts.operation === 'reset'
            ? { success: false, error: 'reset --hard refused' }
            : { success: true }
        ),
    });

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      gitToolFactory,
    });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('APPLY_FAILED');
    const err = (res as { error: string }).error;
    expect(err).toContain('exit 1');
    expect(err).toMatch(/manual recovery/i);
    // The bug being guarded: must NOT tell the customer it was rolled back.
    expect(err).not.toMatch(/changes were rolled back/i);
  });

  it('returns RESTART_FAILED (not a false verified success) when the restart fails', async () => {
    // Guards the bug: a failed restart leaves the old server running, the verify
    // window sees no fresh logs → `noerrlog` → the run would otherwise report
    // success even though the fix was never loaded.
    const action: DiagnoseAction = { type: 'command', command: 'npm install' };
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [action] })] });
    // A second `noerrlog` response is queued to prove we do NOT consume it:
    // the restart guard must return before any verify diagnose runs.
    const diagnose = makeDiagnoseService([
      { success: true, analysis: failing },
      { success: true, analysis: analysis({ status: 'noerrlog' }) },
    ]);
    const executor = makeExecutor({
      success: true,
      applied: [{ action, status: 'applied' }],
    });
    const restart = { restartDevServer: vi.fn().mockResolvedValue({ success: false, error: 'boom' }) };

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      appRestart: restart,
    });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('RESTART_FAILED');
    expect(restart.restartDevServer).toHaveBeenCalledTimes(1);
    // Only the pre-fix diagnose ran — verify must be skipped on restart failure.
    expect(diagnose.diagnose).toHaveBeenCalledTimes(1);
  });

  it('returns SUPERVISOR_UNAVAILABLE when executor reports workspaceUnavailable', async () => {
    const action: DiagnoseAction = { type: 'command', command: 'npm install' };
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [action] })] });

    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({
      success: false,
      workspaceUnavailable: true,
      applied: [{ action, status: 'failed', error: 'no workspace' }],
    });
    const git = makeGitToolFactory();

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      gitToolFactory: git.factory,
    });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('SUPERVISOR_UNAVAILABLE');
    // No rollback when we never touched the workspace.
    expect(git.ops).toEqual([]);
  });

  it('returns VERIFICATION_FAILED when post-fix analysis still failing', async () => {
    const action: DiagnoseAction = { type: 'command', command: 'npm install' };
    const failingPre = analysis({ status: 'failing', issues: [issue({ actions: [action] })] });
    const failingPost = analysis({ status: 'failing', issues: [issue()] });

    const diagnose = makeDiagnoseService([
      { success: true, analysis: failingPre },
      { success: true, analysis: failingPost },
    ]);
    const executor = makeExecutor({
      success: true,
      applied: [{ action, status: 'applied' }],
    });

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
    });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('VERIFICATION_FAILED');
    expect((res as { postFixAnalysis: Analysis }).postFixAnalysis.status).toBe('failing');
  });

  it('propagates verify diagnose failure with its own errorCode', async () => {
    const action: DiagnoseAction = { type: 'command', command: 'npm install' };
    const failingPre = analysis({ status: 'failing', issues: [issue({ actions: [action] })] });

    const diagnose = makeDiagnoseService([
      { success: true, analysis: failingPre },
      {
        success: false,
        error: 'llm down',
        errorCode: 'LLM_FAILURE',
        analysis: analysis({ status: 'unknown' }),
      },
    ]);
    const executor = makeExecutor({
      success: true,
      applied: [{ action, status: 'applied' }],
    });

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
    });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('LLM_FAILURE');
  });

  it('coalesces a concurrent same-intent autoFix onto the in-flight run', async () => {
    const action: DiagnoseAction = { type: 'command', command: 'npm install' };
    const failingPre = analysis({ status: 'failing', issues: [issue({ actions: [action] })] });
    const healthy = analysis({ status: 'healthy', issues: [] });

    // The pre-fix diagnose hangs on a controllable promise so we can fire a
    // second autoFix while the first is still running.
    let unblock!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const diagnose = {
      diagnose: vi.fn().mockImplementation(async () => {
        // Call 1 is the first run's pre-fix (hangs); call 2 is its verify.
        if ((diagnose.diagnose as { mock: { calls: unknown[] } }).mock.calls.length === 1) {
          await firstDone;
          return { success: true, analysis: failingPre };
        }
        return { success: true, analysis: healthy };
      }),
    };
    const executor = makeExecutor({
      success: true,
      applied: [{ action, status: 'applied' }],
    });

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
    });

    const first = svc.autoFix(REQ);
    // Yield so the first call registers its in-flight slot.
    await Promise.resolve();
    const second = svc.autoFix(REQ);
    unblock();

    const [firstRes, secondRes] = await Promise.all([first, second]);

    // The second call rode on the first run instead of being rejected — both
    // see the same successful outcome.
    expect(secondRes.success).toBe(true);
    expect(secondRes).toBe(firstRes);
    // Only one run executed: pre-fix + verify = 2 diagnose calls, 1 apply.
    expect(diagnose.diagnose).toHaveBeenCalledTimes(2);
    expect(executor.execute).toHaveBeenCalledTimes(1);
  });

  it('rejects a concurrent autoFix with different intent (dryRun mismatch)', async () => {
    const action: DiagnoseAction = { type: 'command', command: 'npm install' };
    const failingPre = analysis({ status: 'failing', issues: [issue({ actions: [action] })] });

    let unblock!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const diagnose = {
      diagnose: vi.fn().mockImplementation(async () => {
        await firstDone;
        return { success: true, analysis: failingPre };
      }),
    };
    const executor = makeExecutor({ success: true, applied: [{ action, status: 'applied' }] });

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
    });

    // First run: real (non-dryRun). It hangs in pre-fix.
    const first = svc.autoFix(REQ);
    await Promise.resolve();
    // Second run: dryRun → different intent → must reject, not coalesce.
    const second = await svc.autoFix({ ...REQ, dryRun: true });

    expect(second.success).toBe(false);
    expect((second as { errorCode: string }).errorCode).toBe('ANOTHER_DIAGNOSE_IN_FLIGHT');

    unblock();
    await first; // release the first call so the test exits cleanly
  });

  // ────────────────────────────────────────────────────────────────────
  // Agent fallback
  // ────────────────────────────────────────────────────────────────────

  function makeAgentFixer(result: AgentFixResult): {
    fixer: AgentDrivenFixer;
    applyFix: ReturnType<typeof vi.fn>;
  } {
    const applyFix = vi.fn().mockResolvedValue(result);
    return { fixer: { applyFix }, applyFix };
  }

  it('NO_ACTIONABLE_FIXES still returned when enableAgentFallback is false', async () => {
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({ success: true, summary: 's', toolCallCount: 1 });
    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
    });

    const res = await svc.autoFix(REQ);

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('NO_ACTIONABLE_FIXES');
    expect(fixer.applyFix).not.toHaveBeenCalled();
  });

  it('NO_ACTIONABLE_FIXES still returned when enableAgentFallback is true but no fixer wired', async () => {
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({ success: true, applied: [] });
    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      // agentFixer omitted on purpose
    });

    const res = await svc.autoFix({ ...REQ, enableAgentFallback: true });

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('NO_ACTIONABLE_FIXES');
  });

  it('agent fallback happy path: invokes fixer, commits, restarts, verifies healthy', async () => {
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const healthy = analysis({ status: 'healthy', issues: [] });
    const diagnose = makeDiagnoseService([
      { success: true, analysis: failing },
      { success: true, analysis: healthy },
    ]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({ success: true, summary: 'fixed types', toolCallCount: 3 });
    const git = makeGitToolFactory();
    const restart = { restartDevServer: vi.fn().mockResolvedValue({ success: true }) };

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
      gitToolFactory: git.factory,
      appRestart: restart,
    });

    const res = await svc.autoFix({ ...REQ, enableAgentFallback: true });

    expect(res.success).toBe(true);
    const r = res as {
      restarted: boolean;
      agentFix: { summary: string; toolCallCount: number };
      appliedActions: unknown[];
    };
    expect(r.restarted).toBe(true);
    expect(r.appliedActions).toEqual([]);
    expect(r.agentFix).toEqual({ summary: 'fixed types', toolCallCount: 3 });
    expect(fixer.applyFix).toHaveBeenCalledOnce();
    // executor must NOT run on the agent path.
    expect(executor.execute).not.toHaveBeenCalled();
    // Both commit ops should run (add + commit), not rollback.
    expect(git.ops.map((o) => o.op)).toEqual(['add', 'commit']);
    expect(diagnose.diagnose).toHaveBeenCalledTimes(2);
    // Verify diagnose is scoped to post-restart logs; pre-fix uses the full window.
    const [preFixCall, verifyCall] = diagnose.diagnose.mock.calls;
    expect(preFixCall[0]).not.toHaveProperty('since');
    expect(typeof verifyCall[0].since).toBe('string');
  });

  it('agent fallback verify diagnose uses the restart-boundary timestamp as `since`', async () => {
    // Regression guard: the post-restart verify must scope its log window to
    // logs emitted after the restart began. Otherwise it reuses diagnose's
    // default 3-hour window, re-reads the pre-fix errors, and reports the app
    // as still failing even after a correct fix.
    const FIXED_MS = 1_700_000_000_000;
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const healthy = analysis({ status: 'healthy', issues: [] });
    const diagnose = makeDiagnoseService([
      { success: true, analysis: failing },
      { success: true, analysis: healthy },
    ]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({ success: true, summary: 'fixed', toolCallCount: 0 });
    const restart = { restartDevServer: vi.fn().mockResolvedValue({ success: true }) };

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
      appRestart: restart,
      clock: () => FIXED_MS,
    });

    const res = await svc.autoFix({ ...REQ, enableAgentFallback: true });

    expect(res.success).toBe(true);
    const verifyCall = diagnose.diagnose.mock.calls[1]![0];
    expect(verifyCall.since).toBe(new Date(FIXED_MS).toISOString());
    expect(verifyCall.target).toBe('preview');
  });

  it('agent fallback returns AGENT_FIX_FAILED when fixer reports failure (rolls back)', async () => {
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({
      success: false,
      summary: '',
      toolCallCount: 0,
      error: 'agent timed out',
    });
    const git = makeGitToolFactory();

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
      gitToolFactory: git.factory,
    });

    const res = await svc.autoFix({ ...REQ, enableAgentFallback: true });

    expect(res.success).toBe(false);
    const r = res as { errorCode: string; error: string };
    expect(r.errorCode).toBe('AGENT_FIX_FAILED');
    expect(r.error).toBe('agent timed out');
    expect(git.ops.map((o) => o.op)).toEqual(['reset', 'clean']);
    // Pre-fix only — no verify.
    expect(diagnose.diagnose).toHaveBeenCalledTimes(1);
  });

  it('agent fallback timeout never claims a clean rollback (agent may still be running)', async () => {
    // The wrapper timeout does NOT stop the agent — it has no AbortSignal — so a
    // `git reset` can't be trusted as a clean rollback. The message must warn the
    // workspace is indeterminate, even when git rollback itself succeeds.
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({
      success: false,
      summary: '',
      toolCallCount: 0,
      timedOut: true,
      error: 'Agent fix timed out after 240000ms',
    });
    const git = makeGitToolFactory(); // rollback git ops all succeed

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
      gitToolFactory: git.factory,
    });

    const res = await svc.autoFix({ ...REQ, enableAgentFallback: true });

    expect(res.success).toBe(false);
    const r = res as { errorCode: string; error: string };
    expect(r.errorCode).toBe('AGENT_FIX_FAILED');
    expect(r.error).toMatch(/may still be running/i);
    expect(r.error).toMatch(/indeterminate|manual recovery/i);
    // Must NOT claim a clean rollback on the timeout path.
    expect(r.error).not.toMatch(/changes were rolled back|rolled back/i);
  });

  it('holds the in-flight entry after an agent timeout so a retry cannot start a second writer', async () => {
    // The orphaned agent (no AbortSignal) may still be writing /app after a
    // timeout. The in-flight entry must be held for orphanHoldMs so a same-app
    // retry coalesces/rejects instead of launching a second concurrent writer.
    let now = 1_000;
    const clock = (): number => now;
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({
      success: false,
      summary: '',
      toolCallCount: 0,
      timedOut: true,
      error: 'Agent fix timed out after 240000ms',
    });

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
      clock,
      orphanHoldMs: 5_000,
    });

    const req: AutoFixRequest = { ...REQ, enableAgentFallback: true };

    const r1 = await svc.autoFix(req);
    expect((r1 as { errorCode: string }).errorCode).toBe('AGENT_FIX_FAILED');
    expect(fixer.applyFix).toHaveBeenCalledTimes(1);

    // Same-intent retry DURING the hold → coalesces onto the held result, no new run.
    const r2 = await svc.autoFix(req);
    expect(r2).toBe(r1);
    expect(fixer.applyFix).toHaveBeenCalledTimes(1);

    // Different-intent retry DURING the hold → rejected, still no new run.
    const r3 = await svc.autoFix({ ...REQ, enableAgentFallback: true, dryRun: true });
    expect((r3 as { errorCode: string }).errorCode).toBe('ANOTHER_DIAGNOSE_IN_FLIGHT');
    expect(fixer.applyFix).toHaveBeenCalledTimes(1);

    // Once the hold window passes, a fresh run is allowed again.
    now += 6_000;
    const r4 = await svc.autoFix(req);
    expect((r4 as { errorCode: string }).errorCode).toBe('AGENT_FIX_FAILED');
    expect(fixer.applyFix).toHaveBeenCalledTimes(2);
  });

  it('agent fallback returns RESTART_FAILED (not a false success) when the restart fails', async () => {
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    // Second `noerrlog` queued to prove the verify diagnose is NOT reached.
    const diagnose = makeDiagnoseService([
      { success: true, analysis: failing },
      { success: true, analysis: analysis({ status: 'noerrlog' }) },
    ]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({ success: true, summary: 'edited', toolCallCount: 1 });
    const restart = { restartDevServer: vi.fn().mockResolvedValue({ success: false, error: 'boom' }) };

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
      appRestart: restart,
    });

    const res = await svc.autoFix({ ...REQ, enableAgentFallback: true });

    expect(res.success).toBe(false);
    const r = res as { errorCode: string; agentFix?: { summary: string } };
    expect(r.errorCode).toBe('RESTART_FAILED');
    expect(r.agentFix?.summary).toBe('edited');
    // Pre-fix only — verify must be skipped on restart failure.
    expect(diagnose.diagnose).toHaveBeenCalledTimes(1);
  });

  it('agent fallback with zero last-step tool calls + healthy verify → success', async () => {
    // The reported toolCallCount is informational only — AI SDK 6 reports
    // last-step calls only, so it can be 0 even when edits happened. We
    // always commit + restart + verify regardless; the post-restart diagnose
    // is the source of truth.
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const healthy = analysis({ status: 'healthy', issues: [] });
    const diagnose = makeDiagnoseService([
      { success: true, analysis: failing },
      { success: true, analysis: healthy },
    ]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({
      success: true,
      summary: 'edits applied — build passes',
      toolCallCount: 0,
    });
    const git = makeGitToolFactory();
    const restart = { restartDevServer: vi.fn().mockResolvedValue({ success: true }) };

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
      gitToolFactory: git.factory,
      appRestart: restart,
    });

    const res = await svc.autoFix({ ...REQ, enableAgentFallback: true });

    expect(res.success).toBe(true);
    const r = res as { restarted: boolean; agentFix: { toolCallCount: number } };
    expect(r.restarted).toBe(true);
    expect(r.agentFix.toolCallCount).toBe(0);
    // We always commit on the agent path now (no-op git side if nothing's staged).
    expect(git.ops.map((o) => o.op)).toEqual(['add', 'commit']);
    expect(restart.restartDevServer).toHaveBeenCalledOnce();
    expect(diagnose.diagnose).toHaveBeenCalledTimes(2);
  });

  it('agent fallback with still-failing post-fix → AGENT_FIX_FAILED with both analyses attached', async () => {
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const stillFailing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const diagnose = makeDiagnoseService([
      { success: true, analysis: failing },
      { success: true, analysis: stillFailing },
    ]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({
      success: true,
      summary: 'I tried but the build still fails',
      toolCallCount: 0,
    });
    const git = makeGitToolFactory();

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
      gitToolFactory: git.factory,
    });

    const res = await svc.autoFix({ ...REQ, enableAgentFallback: true });

    expect(res.success).toBe(false);
    const r = res as {
      errorCode: string;
      error: string;
      postFixAnalysis: Analysis;
      agentFix: { summary: string };
    };
    expect(r.errorCode).toBe('AGENT_FIX_FAILED');
    // Caller needs both signals to debug — message should point at both.
    expect(r.error).toMatch(/compare.*summary.*post-restart/i);
    expect(r.postFixAnalysis).toBeDefined();
    expect(r.agentFix.summary).toBe('I tried but the build still fails');
    // Commit attempted on every agent run (no-op if nothing staged).
    expect(git.ops.map((o) => o.op)).toEqual(['add', 'commit']);
  });

  it('agent fallback dryRun does not invoke the fixer or restart', async () => {
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const diagnose = makeDiagnoseService([{ success: true, analysis: failing }]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({ success: true, summary: 's', toolCallCount: 5 });
    const restart = { restartDevServer: vi.fn() };

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
      appRestart: restart,
    });

    const res = await svc.autoFix({ ...REQ, enableAgentFallback: true, dryRun: true });

    expect(res.success).toBe(true);
    expect((res as { agentFix: { toolCallCount: number } }).agentFix.toolCallCount).toBe(0);
    expect(fixer.applyFix).not.toHaveBeenCalled();
    expect(restart.restartDevServer).not.toHaveBeenCalled();
    expect(diagnose.diagnose).toHaveBeenCalledTimes(1);
  });

  it('agent fallback with non-zero last-step tool calls + still failing → AGENT_FIX_FAILED', async () => {
    // The agent path uniformly returns AGENT_FIX_FAILED on a still-failing
    // verify (regardless of the reported toolCallCount, since that count is
    // unreliable under AI SDK 6). VERIFICATION_FAILED is reserved for the
    // action-executor path where actions[] was non-empty and applied cleanly.
    const failing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const stillFailing = analysis({ status: 'failing', issues: [issue({ actions: [] })] });
    const diagnose = makeDiagnoseService([
      { success: true, analysis: failing },
      { success: true, analysis: stillFailing },
    ]);
    const executor = makeExecutor({ success: true, applied: [] });
    const fixer = makeAgentFixer({ success: true, summary: 'tried', toolCallCount: 2 });

    const svc = buildService({
      diagnoseService: diagnose as unknown as DiagnoseService,
      actionExecutor: executor,
      agentFixer: fixer.fixer,
    });

    const res = await svc.autoFix({ ...REQ, enableAgentFallback: true });

    expect(res.success).toBe(false);
    expect((res as { errorCode: string }).errorCode).toBe('AGENT_FIX_FAILED');
    expect((res as { agentFix: { toolCallCount: number } }).agentFix.toolCallCount).toBe(2);
  });
});
