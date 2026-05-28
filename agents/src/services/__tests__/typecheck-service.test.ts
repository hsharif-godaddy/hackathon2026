import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the logger so test output stays clean. We still want to be able to
// assert on specific log calls for skip reasons.
vi.mock('../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  Logger: {
    create: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    })),
  },
}));

vi.mock('../../workspace/index.js', () => ({
  createForWorkspace: vi.fn()
}));

// Import after mocks
import { TypecheckService, parseTscOutput } from '../typecheck-service.js';
import { createForWorkspace } from '../../workspace/index.js';
import { logger } from '../../logging/index.js';
import { makeRunCommandResult } from '../../workspace/__tests__/mock-helpers.js';

const TEST_APP_ID = 'test-app-typecheck';

function makeWorkspace(runCommandSync: (...args: unknown[]) => unknown) {
  return { tasks: { runCommandSync: vi.fn(runCommandSync) } };
}

describe('parseTscOutput', () => {
  it('parses canonical --pretty=false lines into structured errors', () => {
    const stdout = [
      "src/App.tsx(12,3): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/components/Foo.tsx(5,10): error TS2552: Cannot find name 'foo'. Did you mean 'Foo'?",
      ''
    ].join('\n');

    const errors = parseTscOutput(stdout, '');

    expect(errors).toEqual([
      {
        file: 'src/App.tsx',
        line: 12,
        column: 3,
        code: 'TS2322',
        message: "Type 'string' is not assignable to type 'number'."
      },
      {
        file: 'src/components/Foo.tsx',
        line: 5,
        column: 10,
        code: 'TS2552',
        message: "Cannot find name 'foo'. Did you mean 'Foo'?"
      }
    ]);
  });

  it('merges stdout and stderr and dedupes identical diagnostics', () => {
    const stdout = "src/A.ts(1,1): error TS1: same\n";
    const stderr = "src/A.ts(1,1): error TS1: same\nsrc/B.ts(2,2): error TS2: different";

    const errors = parseTscOutput(stdout, stderr);

    expect(errors).toHaveLength(2);
    expect(errors[0]!.file).toBe('src/A.ts');
    expect(errors[1]!.file).toBe('src/B.ts');
  });

  it('ignores non-matching lines without throwing', () => {
    const stdout = 'Found 0 errors.\nversion: 5.1.6';
    expect(parseTscOutput(stdout, '')).toEqual([]);
  });

  it('handles trailing whitespace on diagnostic lines', () => {
    const stdout = "src/App.tsx(1,1): error TS1: msg   ";
    const errors = parseTscOutput(stdout, '');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe('msg');
  });
});

describe('TypecheckService.runTypecheck', () => {
  let service: TypecheckService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TypecheckService();
  });

  it('returns skipped=no_supervisor when workspace returns null', async () => {
    vi.mocked(createForWorkspace).mockReturnValue(null);

    const result = await service.runTypecheck(TEST_APP_ID);

    expect(result).toMatchObject({
      ok: true,
      errors: [],
      skipped: true,
      reason: 'no_supervisor'
    });
  });

  it('returns skipped=no_supervisor when workspace factory throws (e.g. app not found)', async () => {
    vi.mocked(createForWorkspace).mockImplementation(() => {
      throw new Error('App with ID test-app-typecheck not found');
    });

    const result = await service.runTypecheck(TEST_APP_ID);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_supervisor');
  });

  it('returns ok=true with no errors on clean exitCode=0', async () => {
    const workspace = makeWorkspace(async () => makeRunCommandResult({ executionTimeMs: 1500 }));
    vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

    const result = await service.runTypecheck(TEST_APP_ID);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.skipped).toBeUndefined();
    expect(result.durationMs).toBeTypeOf('number');
    expect(workspace.tasks.runCommandSync).toHaveBeenCalledWith({
      command: 'npx tsc --noEmit --pretty false',
      workingDir: '/app',
      timeoutSeconds: 30
    });
  });

  it('returns ok=false with parsed errors on non-zero exit + diagnostics', async () => {
    const workspace = makeWorkspace(async () => makeRunCommandResult({
      exitCode: 2,
      stdout: "src/App.tsx(12,3): error TS2322: Type 'string' is not assignable to type 'number'.",
    }));
    vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

    const result = await service.runTypecheck(TEST_APP_ID);

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ file: 'src/App.tsx', code: 'TS2322' });
  });

  it('returns skipped=timeout when dev-supervisor reports timedOut', async () => {
    const workspace = makeWorkspace(async () => makeRunCommandResult({
      exitCode: -1,
      timedOut: true,
      executionTimeMs: 30_000,
    }));
    vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

    const result = await service.runTypecheck(TEST_APP_ID);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('timeout');
  });

  it('returns skipped=exec_failure when tsc crashes (non-zero, no diagnostics)', async () => {
    const workspace = makeWorkspace(async () => makeRunCommandResult({
      exitCode: 1,
      stderr: 'FATAL: JavaScript heap out of memory',
    }));
    vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

    const result = await service.runTypecheck(TEST_APP_ID);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('exec_failure');
  });

  it('returns skipped=preview_stopped when exec throws ECONNREFUSED (raw)', async () => {
    const workspace = makeWorkspace(async () => {
      throw new Error('connect ECONNREFUSED /tmp/preview.sock');
    });
    vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

    const result = await service.runTypecheck(TEST_APP_ID);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('preview_stopped');
  });

  it('returns skipped=preview_stopped when workspace wraps ENOENT into "dev-supervisor not available"', async () => {
    const workspace = makeWorkspace(async () => {
      throw new Error('dev-supervisor not available at /tmp/preview.sock');
    });
    vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

    const result = await service.runTypecheck(TEST_APP_ID);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('preview_stopped');
  });

  it('returns skipped=preview_stopped when workspace wraps ECONNREFUSED into "connection refused"', async () => {
    const workspace = makeWorkspace(async () => {
      throw new Error('dev-supervisor TCP connection refused at tcp://localhost:8080');
    });
    vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

    const result = await service.runTypecheck(TEST_APP_ID);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('preview_stopped');
  });

  it('returns skipped=aborted when signal is already aborted', async () => {
    const workspace = makeWorkspace(async () => makeRunCommandResult());
    vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

    const controller = new AbortController();
    controller.abort();

    const result = await service.runTypecheck(TEST_APP_ID, { signal: controller.signal });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('aborted');
    expect(workspace.tasks.runCommandSync).not.toHaveBeenCalled();
  });

  it('aborts mid-exec when signal fires during a slow check', async () => {
    const workspace = makeWorkspace(() => new Promise(() => {
      // Never resolves — simulate a hung exec.
    }));
    vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

    const controller = new AbortController();
    const pending = service.runTypecheck(TEST_APP_ID, { signal: controller.signal });

    // Fire the abort after a micro-tick so the race has attached its listener.
    await Promise.resolve();
    controller.abort();

    const result = await pending;

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('aborted');
  });

  it('emits agent.typecheck.skipped log when timing out', async () => {
    const workspace = makeWorkspace(async () => makeRunCommandResult({
      exitCode: -1,
      timedOut: true,
      executionTimeMs: 30_000,
    }));
    vi.mocked(createForWorkspace).mockReturnValue(workspace as never);

    await service.runTypecheck(TEST_APP_ID);

    expect(logger.warn).toHaveBeenCalledWith(
      'agent.typecheck.skipped',
      expect.objectContaining({ reason: 'timeout', appId: TEST_APP_ID })
    );
  });
});
