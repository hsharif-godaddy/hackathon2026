import { describe, it, expect, vi } from 'vitest';

import { DevelopAgentFixer, type AgentInvoker } from '../AgentDrivenFixer.js';
import type { Analysis, Issue } from '../../diagnose/types.js';

const APP_ID = 'app-abc1234567';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'iss-1',
    category: 'Build',
    severity: 'error',
    message: 'TypeScript compilation failed in src/server.ts:7.',
    recommendation: 'Open src/server.ts at line 7, fix the type error.',
    confidence: 80,
    source: 'pattern',
    relatedLogs: ["error TS2322: Type 'string' is not assignable to type 'number'."],
    ...overrides,
  };
}

function analysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    status: 'failing',
    issues: [issue()],
    summary: { totalIssues: 1, errors: 1, warnings: 0, primaryRecommendation: 'fix the type error' },
    metadata: { logsAnalyzed: 1, tierUsed: 'pattern', analysisTimeMs: 1 },
    ...overrides,
  };
}

describe('DevelopAgentFixer', () => {
  it('returns unavailable when resolver yields no agent', async () => {
    const fixer = new DevelopAgentFixer(() => null);

    const res = await fixer.applyFix(APP_ID, analysis());

    expect(res.success).toBe(false);
    expect(res.unavailable).toBe(true);
    expect(res.toolCallCount).toBe(0);
  });

  it('passes appId via executionContext.metadata to the agent', async () => {
    const generate = vi.fn().mockResolvedValue({ content: 'done', toolCalls: [{}, {}, {}] });
    const agent: AgentInvoker = { generate };
    const fixer = new DevelopAgentFixer(() => agent);

    const res = await fixer.applyFix(APP_ID, analysis());

    expect(res.success).toBe(true);
    expect(res.toolCallCount).toBe(3);
    expect(generate).toHaveBeenCalledOnce();
    const [prompt, options] = generate.mock.calls[0]!;
    expect(typeof prompt).toBe('string');
    // Critical contract: tools resolve workspace via context.metadata.appId.
    expect(options).toEqual({ executionContext: { metadata: { appId: APP_ID } } });
    // Sanity: prompt mentions the issue and the recommendation so the agent has context.
    expect(prompt).toContain('TypeScript compilation failed');
    expect(prompt).toContain('Open src/server.ts');
    expect(prompt).toContain("error TS2322");
    // Verification step: prompt must instruct the agent to run the build,
    // even when the workspace looks correct. Without this the agent can
    // bail out with toolCallCount=0 on a stale-log false positive.
    expect(prompt).toMatch(/run the .*build.*command/i);
  });

  it('returns failure when agent throws', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('boom'));
    const agent: AgentInvoker = { generate };
    const fixer = new DevelopAgentFixer(() => agent);

    const res = await fixer.applyFix(APP_ID, analysis());

    expect(res.success).toBe(false);
    expect(res.unavailable).toBeUndefined();
    expect(res.error).toBe('boom');
    expect(res.toolCallCount).toBe(0);
    // A thrown error is not a timeout — the flag must stay unset.
    expect(res.timedOut).toBeUndefined();
  });

  it('honors timeout', async () => {
    // Agent that never resolves.
    const agent: AgentInvoker = {
      generate: () => new Promise(() => undefined),
    };
    const fixer = new DevelopAgentFixer(() => agent, { timeoutMs: 10 });

    const res = await fixer.applyFix(APP_ID, analysis());

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/timed out/i);
    // The caller relies on this flag to refuse claiming a clean rollback — the
    // agent has no AbortSignal and may still be running after the timeout.
    expect(res.timedOut).toBe(true);
  });

  it('treats undefined toolCalls as zero', async () => {
    const generate = vi.fn().mockResolvedValue({ content: 'no tools used' });
    const agent: AgentInvoker = { generate };
    const fixer = new DevelopAgentFixer(() => agent);

    const res = await fixer.applyFix(APP_ID, analysis());

    expect(res.success).toBe(true);
    expect(res.toolCallCount).toBe(0);
    expect(res.summary).toBe('no tools used');
  });
});
