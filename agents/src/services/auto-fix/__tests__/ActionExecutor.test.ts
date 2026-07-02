import { describe, it, expect, vi } from 'vitest';

import { WorkspaceActionExecutor } from '../ActionExecutor.js';
import type { WorkspaceClient } from '../../../workspace/client.js';
import type { DiagnoseAction } from '../../diagnose/types.js';
import type { AppliedAction } from '../types.js';

const APP_ID = 'app-1234567890';

/** Assert-and-narrow an AppliedAction to the 'failed' variant so `.error` is typed. */
function failedAction(action: AppliedAction | undefined): Extract<AppliedAction, { status: 'failed' }> {
  if (action?.status !== 'failed') {
    throw new Error(`expected a failed action, got status=${action?.status ?? 'undefined'}`);
  }
  return action;
}

function makeWorkspace(overrides?: {
  runCommandSync?: ReturnType<typeof vi.fn>;
  edit?: ReturnType<typeof vi.fn>;
  write?: ReturnType<typeof vi.fn>;
}): WorkspaceClient {
  const runCommandSync =
    overrides?.runCommandSync ??
    vi.fn().mockResolvedValue({
      taskId: 't1',
      exitCode: 0,
      timedOut: false,
      stdout: 'ok',
      stderr: '',
      executionTimeMs: 1,
    });
  const edit =
    overrides?.edit ??
    vi.fn().mockResolvedValue({ applied: 1 });
  const write =
    overrides?.write ??
    vi.fn().mockResolvedValue({ bytesWritten: 42 });

  return {
    workspaceId: APP_ID,
    variant: 'preview',
    summary: vi.fn(),
    capabilities: vi.fn(),
    files: { edit, write, readText: vi.fn().mockResolvedValue('') } as unknown as WorkspaceClient['files'],
    tasks: { runCommandSync } as unknown as WorkspaceClient['tasks'],
    runtime: {} as WorkspaceClient['runtime'],
    diagnostics: {} as WorkspaceClient['diagnostics'],
    artifacts: {} as WorkspaceClient['artifacts'],
    imports: {} as WorkspaceClient['imports'],
    deployments: {} as WorkspaceClient['deployments'],
    versionControl: {} as WorkspaceClient['versionControl'],
    config: {} as WorkspaceClient['config'],
  };
}

describe('WorkspaceActionExecutor', () => {
  it('returns workspaceUnavailable when factory yields null', async () => {
    const executor = new WorkspaceActionExecutor(() => null);
    const actions: DiagnoseAction[] = [{ type: 'command', command: 'npm install' }];

    const result = await executor.execute(APP_ID, actions);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.workspaceUnavailable).toBe(true);
    }
    expect(result.applied).toHaveLength(1);
    expect(failedAction(result.applied[0]).error).toContain('unavailable');
  });

  describe('command actions', () => {
    it('marks command applied on exit 0', async () => {
      const workspace = makeWorkspace();
      const executor = new WorkspaceActionExecutor(() => workspace);

      const result = await executor.execute(APP_ID, [
        { type: 'command', command: 'npm install lodash' },
      ]);

      expect(result.success).toBe(true);
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0]?.status).toBe('applied');
      expect(workspace.tasks.runCommandSync).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'npm install lodash', captureOutput: true })
      );
    });

    it('forwards cwd when provided', async () => {
      const workspace = makeWorkspace();
      const executor = new WorkspaceActionExecutor(() => workspace);

      await executor.execute(APP_ID, [
        { type: 'command', command: 'npm test', cwd: '/app/packages/foo' },
      ]);

      expect(workspace.tasks.runCommandSync).toHaveBeenCalledWith(
        expect.objectContaining({ workingDir: '/app/packages/foo' })
      );
    });

    it('marks command failed on non-zero exit and skips remaining actions', async () => {
      const runCommandSync = vi
        .fn()
        .mockResolvedValueOnce({
          taskId: 't1',
          exitCode: 1,
          timedOut: false,
          stdout: '',
          stderr: 'oh no',
          executionTimeMs: 1,
        });
      const workspace = makeWorkspace({ runCommandSync });
      const executor = new WorkspaceActionExecutor(() => workspace);

      const result = await executor.execute(APP_ID, [
        { type: 'command', command: 'npm test' },
        { type: 'command', command: 'npm build' },
      ]);

      expect(result.success).toBe(false);
      expect(failedAction(result.applied[0]).error).toContain('exited with code 1');
      expect(result.applied[1]?.status).toBe('skipped');
      // Second command never executed.
      expect(runCommandSync).toHaveBeenCalledTimes(1);
    });

    it('marks command failed on timeout', async () => {
      const runCommandSync = vi.fn().mockResolvedValue({
        taskId: 't1',
        exitCode: 0,
        timedOut: true,
        stdout: '',
        stderr: '',
        executionTimeMs: 60_001,
      });
      const workspace = makeWorkspace({ runCommandSync });
      const executor = new WorkspaceActionExecutor(() => workspace);

      const result = await executor.execute(APP_ID, [
        { type: 'command', command: 'sleep 999' },
      ]);

      expect(result.success).toBe(false);
      expect(failedAction(result.applied[0]).error).toContain('timed out');
    });

    it('captures thrown adapter errors as failed entries', async () => {
      const runCommandSync = vi.fn().mockRejectedValue(new Error('socket hangup'));
      const workspace = makeWorkspace({ runCommandSync });
      const executor = new WorkspaceActionExecutor(() => workspace);

      const result = await executor.execute(APP_ID, [
        { type: 'command', command: 'npm install' },
      ]);

      expect(result.success).toBe(false);
      expect(failedAction(result.applied[0]).error).toBe('socket hangup');
    });
  });

  describe('file_edit actions', () => {
    it('uses files.edit when both before and after are present', async () => {
      const edit = vi.fn().mockResolvedValue({ applied: 2 });
      const workspace = makeWorkspace({ edit });
      const executor = new WorkspaceActionExecutor(() => workspace);

      const result = await executor.execute(APP_ID, [
        {
          type: 'file_edit',
          path: 'package.json',
          description: 'add lodash',
          before: '"react": "18"',
          after: '"react": "18",\n    "lodash": "^4"',
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.applied[0]?.status).toBe('applied');
      expect(edit).toHaveBeenCalledWith({
        path: 'package.json',
        oldString: '"react": "18"',
        newString: '"react": "18",\n    "lodash": "^4"',
      });
    });

    it('marks file_edit failed when edit applies 0 occurrences', async () => {
      const edit = vi.fn().mockResolvedValue({ applied: 0 });
      const workspace = makeWorkspace({ edit });
      const executor = new WorkspaceActionExecutor(() => workspace);

      const result = await executor.execute(APP_ID, [
        {
          type: 'file_edit',
          path: 'package.json',
          description: 'add lodash',
          before: 'something the LLM hallucinated',
          after: 'replacement',
        },
      ]);

      expect(result.success).toBe(false);
      expect(failedAction(result.applied[0]).error).toContain('No occurrences');
    });

    it('uses files.write when only after is present (full-file replace)', async () => {
      const write = vi.fn().mockResolvedValue({ bytesWritten: 100 });
      const workspace = makeWorkspace({ write });
      const executor = new WorkspaceActionExecutor(() => workspace);

      const result = await executor.execute(APP_ID, [
        {
          type: 'file_edit',
          path: 'src/new-file.ts',
          description: 'create file',
          after: 'export const x = 1;',
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.applied[0]?.status).toBe('applied');
      expect(write).toHaveBeenCalledWith({
        path: 'src/new-file.ts',
        content: 'export const x = 1;',
      });
    });

    it('skips file_edit when neither before nor after is present', async () => {
      const edit = vi.fn();
      const write = vi.fn();
      const workspace = makeWorkspace({ edit, write });
      const executor = new WorkspaceActionExecutor(() => workspace);

      const result = await executor.execute(APP_ID, [
        { type: 'file_edit', path: 'foo.ts', description: 'manual' },
      ]);

      // A skipped action does not abort the batch.
      expect(result.success).toBe(true);
      expect(result.applied[0]?.status).toBe('skipped');
      expect(edit).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
    });
  });

  it('runs mixed actions in order and stops on first failure', async () => {
    const runCommandSync = vi
      .fn()
      .mockResolvedValueOnce({
        taskId: 't1',
        exitCode: 0,
        timedOut: false,
        stdout: '',
        stderr: '',
        executionTimeMs: 1,
      })
      .mockResolvedValueOnce({
        taskId: 't2',
        exitCode: 1,
        timedOut: false,
        stdout: '',
        stderr: 'fail',
        executionTimeMs: 1,
      });
    const edit = vi.fn().mockResolvedValue({ applied: 1 });
    const workspace = makeWorkspace({ runCommandSync, edit });
    const executor = new WorkspaceActionExecutor(() => workspace);

    const actions: DiagnoseAction[] = [
      { type: 'command', command: 'npm install' },
      {
        type: 'file_edit',
        path: 'a.ts',
        description: 'patch',
        before: 'old',
        after: 'new',
      },
      { type: 'command', command: 'npm run build' },
      { type: 'command', command: 'npm start' },
    ];

    const result = await executor.execute(APP_ID, actions);

    expect(result.success).toBe(false);
    expect(result.applied.map((a) => a.status)).toEqual([
      'applied',
      'applied',
      'failed',
      'skipped',
    ]);
    expect(runCommandSync).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
