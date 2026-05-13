import type { DevSupervisorClient, ExecOptions } from '../../services/DevSupervisorClient.js';
import type {
  WorkspaceTasks,
  RunCommandOptions,
  RunCommandResponse,
  RunCommandResult,
  TaskStatus,
  TaskOutput,
} from '../tasks.js';
import { WorkspaceNotImplementedError, WorkspaceValidationError } from '../errors.js';

function syntheticTaskId(): string {
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function validateSupported(options: RunCommandOptions): void {
  if (options.env !== undefined) {
    throw new WorkspaceValidationError(
      'tasks.runCommand: "env" is not supported by this adapter',
      'env',
    );
  }
  if (options.syncDeadlineMs !== undefined) {
    throw new WorkspaceValidationError(
      'tasks.runCommand: "syncDeadlineMs" is not supported by this adapter',
      'syncDeadlineMs',
    );
  }
}

export class HttpTasks implements WorkspaceTasks {
  constructor(private readonly client: DevSupervisorClient) {}

  async runCommand(options: RunCommandOptions): Promise<RunCommandResponse> {
    const mode = options.mode ?? 'auto';
    if (mode === 'async') {
      throw new WorkspaceNotImplementedError('tasks.runCommand (async mode)');
    }
    const result = await this.runCommandSync(options);
    return { kind: 'completed', ...result };
  }

  async runCommandSync(options: RunCommandOptions): Promise<RunCommandResult> {
    validateSupported(options);
    const wire: ExecOptions = {
      command: options.command,
      working_dir: options.workingDir,
      timeout: options.timeoutSeconds,
      capture_output: options.captureOutput,
    };
    const raw = await this.client.exec(wire);
    return {
      taskId: syntheticTaskId(),
      exitCode: raw.exit_code ?? 0,
      timedOut: Boolean(raw.timed_out),
      stdout: raw.stdout ?? '',
      stderr: raw.stderr ?? '',
      executionTimeMs: raw.execution_time ?? 0,
    };
  }

  async runCommandAsync(_options: RunCommandOptions): Promise<{ taskId: string }> {
    throw new WorkspaceNotImplementedError('tasks.runCommandAsync');
  }

  async get(_taskId: string): Promise<TaskStatus> {
    throw new WorkspaceNotImplementedError('tasks.get');
  }

  async output(_taskId: string, _since?: number, _max?: number): Promise<TaskOutput> {
    throw new WorkspaceNotImplementedError('tasks.output');
  }

  async cancel(_taskId: string): Promise<{ state: 'canceled' | 'already_finished' }> {
    throw new WorkspaceNotImplementedError('tasks.cancel');
  }
}
