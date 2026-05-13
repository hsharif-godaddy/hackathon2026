import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DevSupervisorClient } from '../../../services/DevSupervisorClient.js';
import { HttpTasks } from '../http-tasks.js';
import { WorkspaceNotImplementedError, WorkspaceValidationError } from '../../errors.js';

function makeClient() {
  return { exec: vi.fn() } as unknown as DevSupervisorClient;
}

describe('HttpTasks', () => {
  let client: DevSupervisorClient;
  let tasks: HttpTasks;

  beforeEach(() => {
    client = makeClient();
    tasks = new HttpTasks(client);
  });

  it('runCommandSync returns a RunCommandResult with a synthesized taskId', async () => {
    (client.exec as any).mockResolvedValue({
      command: 'ls',
      exit_code: 0,
      stdout: 'a\nb\n',
      stderr: '',
      execution_time: 12,
      success: true,
      timed_out: false,
    });

    const result = await tasks.runCommandSync({ command: 'ls' });

    expect(client.exec).toHaveBeenCalledWith({
      command: 'ls',
      working_dir: undefined,
      timeout: undefined,
      capture_output: undefined,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('a\nb\n');
    expect(result.timedOut).toBe(false);
    expect(result.executionTimeMs).toBe(12);
    expect(result.taskId).toMatch(/^sync-/);
  });

  it('runCommandSync forwards workingDir, timeout, captureOutput', async () => {
    (client.exec as any).mockResolvedValue({
      command: 'pnpm test',
      exit_code: 1,
      stdout: '',
      stderr: 'fail',
      execution_time: 500,
      success: false,
      timed_out: false,
    });

    await tasks.runCommandSync({
      command: 'pnpm test',
      workingDir: '/app',
      timeoutSeconds: 60,
      captureOutput: false,
    });

    expect(client.exec).toHaveBeenCalledWith({
      command: 'pnpm test',
      working_dir: '/app',
      timeout: 60,
      capture_output: false,
    });
  });

  it('runCommandSync throws WorkspaceValidationError when env is supplied', async () => {
    await expect(
      tasks.runCommandSync({ command: 'ls', env: { FOO: 'bar' } }),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('runCommandSync throws WorkspaceValidationError when syncDeadlineMs is supplied', async () => {
    await expect(
      tasks.runCommandSync({ command: 'ls', syncDeadlineMs: 5000 }),
    ).rejects.toBeInstanceOf(WorkspaceValidationError);
  });

  it('runCommand (auto) returns completed kind', async () => {
    (client.exec as any).mockResolvedValue({
      command: 'echo hi',
      exit_code: 0,
      stdout: 'hi\n',
      stderr: '',
      execution_time: 5,
      success: true,
      timed_out: false,
    });
    const response = await tasks.runCommand({ command: 'echo hi' });
    expect(response.kind).toBe('completed');
    if (response.kind === 'completed') {
      expect(response.stdout).toBe('hi\n');
    }
  });

  it('runCommand with explicit mode sync returns completed kind', async () => {
    (client.exec as any).mockResolvedValue({
      command: 'true',
      exit_code: 0,
      stdout: '',
      stderr: '',
      execution_time: 1,
      success: true,
      timed_out: false,
    });
    const response = await tasks.runCommand({ command: 'true', mode: 'sync' });
    expect(response.kind).toBe('completed');
  });

  it('runCommand with mode async throws WorkspaceNotImplementedError', async () => {
    await expect(
      tasks.runCommand({ command: 'ls', mode: 'async' }),
    ).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
  });

  it('runCommandAsync throws WorkspaceNotImplementedError', async () => {
    await expect(tasks.runCommandAsync({ command: 'ls' })).rejects.toBeInstanceOf(
      WorkspaceNotImplementedError,
    );
  });

  it('get, output, cancel all throw WorkspaceNotImplementedError', async () => {
    await expect(tasks.get('x')).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
    await expect(tasks.output('x')).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
    await expect(tasks.cancel('x')).rejects.toBeInstanceOf(WorkspaceNotImplementedError);
  });
});
