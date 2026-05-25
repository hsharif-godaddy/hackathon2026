import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DevSupervisorClient } from '../../../services/DevSupervisorClient.js';
import { HttpTasks } from '../http-tasks.js';

function makeClient() {
  return {
    exec: vi.fn(),
    submitTask: vi.fn(),
    getTask: vi.fn(),
    getTaskOutput: vi.fn(),
    cancelTask: vi.fn(),
  } as unknown as DevSupervisorClient;
}

describe('HttpTasks', () => {
  let client: DevSupervisorClient;
  let tasks: HttpTasks;

  beforeEach(() => {
    client = makeClient();
    tasks = new HttpTasks(client);
  });

  describe('runCommandSync', () => {
    it('submits with wait_seconds equal to timeout and returns completed result', async () => {
      (client.submitTask as any).mockResolvedValue({
        kind: 'completed',
        task_id: 'task-1',
        exit_code: 0,
        stdout: 'hello\n',
        stderr: '',
        execution_time_ms: 12,
        timed_out: false,
        command_id: 1,
      });

      const result = await tasks.runCommandSync({ command: 'echo hello' });

      expect(client.submitTask).toHaveBeenCalledWith({
        command: 'echo hello',
        working_dir: undefined,
        timeout: 30,
        env: undefined,
        wait_seconds: 30,
      });
      expect(result.taskId).toBe('task-1');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello\n');
      expect(result.timedOut).toBe(false);
      expect(result.executionTimeMs).toBe(12);
    });

    it('forwards workingDir, timeout, env', async () => {
      (client.submitTask as any).mockResolvedValue({
        kind: 'completed',
        task_id: 'task-2',
        exit_code: 1,
        stdout: '',
        stderr: 'fail',
        execution_time_ms: 500,
        timed_out: false,
        command_id: 2,
      });

      await tasks.runCommandSync({
        command: 'pnpm test',
        workingDir: '/app',
        timeoutSeconds: 60,
        env: { NODE_ENV: 'test' },
      });

      expect(client.submitTask).toHaveBeenCalledWith({
        command: 'pnpm test',
        working_dir: '/app',
        timeout: 60,
        env: { NODE_ENV: 'test' },
        wait_seconds: 60,
      });
    });

    it('fetches partial output when server returns accepted', async () => {
      (client.submitTask as any).mockResolvedValue({
        kind: 'accepted',
        task_id: 'task-3',
        state: 'running',
      });
      (client.getTaskOutput as any).mockResolvedValue({
        stdout: 'partial output',
        stderr: 'partial err',
        next_offset: 1,
        next_stderr_offset: 1,
        complete: false,
      });

      const result = await tasks.runCommandSync({ command: 'sleep 100', timeoutSeconds: 5 });

      expect(result.taskId).toBe('task-3');
      expect(result.exitCode).toBe(-1);
      expect(result.timedOut).toBe(true);
      expect(result.stdout).toBe('partial output');
      expect(result.stderr).toBe('partial err');
      expect(result.executionTimeMs).toBe(5000);
    });
  });

  describe('runCommand (auto mode)', () => {
    it('returns completed kind for fast commands', async () => {
      (client.submitTask as any).mockResolvedValue({
        kind: 'completed',
        task_id: 'task-4',
        exit_code: 0,
        stdout: 'hi\n',
        stderr: '',
        execution_time_ms: 5,
        timed_out: false,
        command_id: 4,
      });

      const response = await tasks.runCommand({ command: 'echo hi' });
      expect(response.kind).toBe('completed');
      if (response.kind === 'completed') {
        expect(response.stdout).toBe('hi\n');
      }
    });

    it('with explicit mode sync returns completed kind', async () => {
      (client.submitTask as any).mockResolvedValue({
        kind: 'completed',
        task_id: 'task-5',
        exit_code: 0,
        stdout: '',
        stderr: '',
        execution_time_ms: 1,
        timed_out: false,
        command_id: 5,
      });

      const response = await tasks.runCommand({ command: 'true', mode: 'sync' });
      expect(response.kind).toBe('completed');
    });

    it('with mode async calls submitTask with wait_seconds=0', async () => {
      (client.submitTask as any).mockResolvedValue({
        kind: 'accepted',
        task_id: 'task-6',
        state: 'running',
      });

      const response = await tasks.runCommand({ command: 'sleep 10', mode: 'async' });
      expect(response.kind).toBe('accepted');
      expect(client.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({ wait_seconds: 0 }),
      );
    });

    it('with syncDeadlineMs maps to wait_seconds', async () => {
      (client.submitTask as any).mockResolvedValue({
        kind: 'accepted',
        task_id: 'task-7',
        state: 'running',
      });

      await tasks.runCommand({ command: 'sleep 30', syncDeadlineMs: 3000, timeoutSeconds: 60 });

      expect(client.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({ wait_seconds: 3 }),
      );
    });
  });

  describe('runCommandAsync', () => {
    it('submits with wait_seconds=0 and returns taskId', async () => {
      (client.submitTask as any).mockResolvedValue({
        kind: 'accepted',
        task_id: 'task-8',
        state: 'queued',
      });

      const result = await tasks.runCommandAsync({ command: 'ls' });
      expect(result.taskId).toBe('task-8');
      expect(client.submitTask).toHaveBeenCalledWith(
        expect.objectContaining({ wait_seconds: 0 }),
      );
    });
  });

  describe('get', () => {
    it('returns task status', async () => {
      (client.getTask as any).mockResolvedValue({
        task_id: 'task-9',
        state: 'succeeded',
        command: 'echo x',
        exit_code: 0,
        timed_out: false,
        started_at: '2026-05-01T10:00:00Z',
        finished_at: '2026-05-01T10:00:01Z',
        execution_time_ms: 1000,
        command_id: 9,
      });

      const status = await tasks.get('task-9');
      expect(status.taskId).toBe('task-9');
      expect(status.kind).toBe('completed');
      expect(status.state).toBe('succeeded');
      expect(status.exitCode).toBe(0);
      expect(status.startedAt).toBeInstanceOf(Date);
      expect(status.finishedAt).toBeInstanceOf(Date);
    });
  });

  describe('output', () => {
    it('returns task output with offset', async () => {
      (client.getTaskOutput as any).mockResolvedValue({
        stdout: 'line1\nline2',
        stderr: '',
        next_offset: 2,
        next_stderr_offset: 0,
        complete: true,
      });

      const output = await tasks.output('task-10', 0, 100);
      expect(output.stdout).toBe('line1\nline2');
      expect(output.nextOffset).toBe(2);
      expect(output.nextStderrOffset).toBe(0);
      expect(output.complete).toBe(true);
      expect(client.getTaskOutput).toHaveBeenCalledWith('task-10', 0, 100);
    });
  });

  describe('cancel', () => {
    it('returns canceled state', async () => {
      (client.cancelTask as any).mockResolvedValue({ state: 'canceled' });

      const result = await tasks.cancel('task-11');
      expect(result.state).toBe('canceled');
      expect(client.cancelTask).toHaveBeenCalledWith('task-11');
    });

    it('returns already_finished state', async () => {
      (client.cancelTask as any).mockResolvedValue({ state: 'already_finished' });

      const result = await tasks.cancel('task-12');
      expect(result.state).toBe('already_finished');
    });
  });
});
