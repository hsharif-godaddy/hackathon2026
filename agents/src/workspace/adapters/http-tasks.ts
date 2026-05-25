import type { DevSupervisorClient } from '../../services/DevSupervisorClient.js';
import type {
  WorkspaceTasks,
  RunCommandOptions,
  RunCommandResponse,
  RunCommandResult,
  TaskState,
  TaskStatus,
  TaskOutput,
} from '../tasks.js';

const terminalStates = new Set<TaskState>(['succeeded', 'failed', 'canceled', 'timed_out']);

export class HttpTasks implements WorkspaceTasks {
  constructor(private readonly client: DevSupervisorClient) {}

  async runCommand(options: RunCommandOptions): Promise<RunCommandResponse> {
    const mode = options.mode ?? 'auto';

    if (mode === 'async') {
      const response = await this.client.submitTask({
        command: options.command,
        working_dir: options.workingDir,
        timeout: options.timeoutSeconds,
        env: options.env,
        wait_seconds: 0,
      });
      return {
        kind: 'accepted',
        taskId: response.task_id,
        state: (response.kind === 'completed' ? 'running' : response.state) as Extract<TaskState, 'queued' | 'running'>,
      };
    }

    const waitSeconds =
      mode === 'sync'
        ? (options.timeoutSeconds ?? 30)
        : options.syncDeadlineMs !== undefined
          ? Math.ceil(options.syncDeadlineMs / 1000)
          : (options.timeoutSeconds ?? 30);

    const response = await this.client.submitTask({
      command: options.command,
      working_dir: options.workingDir,
      timeout: options.timeoutSeconds,
      env: options.env,
      wait_seconds: waitSeconds,
    });

    if (response.kind === 'completed') {
      return {
        kind: 'completed',
        taskId: response.task_id,
        exitCode: response.exit_code,
        timedOut: response.timed_out,
        stdout: response.stdout,
        stderr: response.stderr,
        executionTimeMs: response.execution_time_ms,
      };
    }

    return {
      kind: 'accepted',
      taskId: response.task_id,
      state: response.state as Extract<TaskState, 'queued' | 'running'>,
    };
  }

  async runCommandSync(options: RunCommandOptions): Promise<RunCommandResult> {
    const timeoutSec = options.timeoutSeconds ?? 30;

    const response = await this.client.submitTask({
      command: options.command,
      working_dir: options.workingDir,
      timeout: timeoutSec,
      env: options.env,
      wait_seconds: timeoutSec,
    });

    if (response.kind === 'completed') {
      return {
        taskId: response.task_id,
        exitCode: response.exit_code,
        timedOut: response.timed_out,
        stdout: response.stdout,
        stderr: response.stderr,
        executionTimeMs: response.execution_time_ms,
      };
    }

    // Server returned accepted — command is still running past our wait.
    // Fetch whatever output is available so far.
    const output = await this.client.getTaskOutput(response.task_id);
    return {
      taskId: response.task_id,
      exitCode: -1,
      timedOut: false,
      stdout: output.stdout,
      stderr: output.stderr,
      executionTimeMs: 0,
    };
  }

  async runCommandAsync(options: RunCommandOptions): Promise<{ taskId: string }> {
    const response = await this.client.submitTask({
      command: options.command,
      working_dir: options.workingDir,
      timeout: options.timeoutSeconds,
      env: options.env,
      wait_seconds: 0,
    });

    return { taskId: response.task_id };
  }

  async get(taskId: string): Promise<TaskStatus> {
    const result = await this.client.getTask(taskId);
    const isTerminal = terminalStates.has(result.state);
    return {
      taskId: result.task_id,
      kind: isTerminal ? 'completed' : 'pending',
      state: result.state,
      exitCode: result.exit_code,
      timedOut: result.timed_out,
      startedAt: result.started_at ? new Date(result.started_at) : new Date(),
      finishedAt: result.finished_at ? new Date(result.finished_at) : undefined,
      executionTimeMs: result.execution_time_ms,
    };
  }

  async output(taskId: string, since?: number, max?: number): Promise<TaskOutput> {
    const result = await this.client.getTaskOutput(taskId, since, max);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      nextOffset: result.next_offset,
      nextStderrOffset: result.next_stderr_offset,
      complete: result.complete,
    };
  }

  async cancel(taskId: string): Promise<{ state: 'canceled' | 'already_finished' }> {
    const result = await this.client.cancelTask(taskId);
    return { state: result.state };
  }
}
