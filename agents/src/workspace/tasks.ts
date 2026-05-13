export type TaskState = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'timed_out';

export interface RunCommandOptions {
  command: string;
  workingDir?: string;
  env?: Record<string, string>;
  timeoutSeconds?: number;
  captureOutput?: boolean;
  mode?: 'sync' | 'async' | 'auto';
  syncDeadlineMs?: number;
}

export interface RunCommandResult {
  taskId: string;
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  executionTimeMs: number;
}

export type RunCommandResponse =
  | ({ kind: 'completed' } & RunCommandResult)
  | { kind: 'accepted'; taskId: string; state: Extract<TaskState, 'queued' | 'running'> };

export interface TaskStatus {
  taskId: string;
  kind: string;
  state: TaskState;
  exitCode?: number;
  timedOut?: boolean;
  startedAt: Date;
  finishedAt?: Date;
  executionTimeMs?: number;
}

export interface TaskOutput {
  stdout: string;
  stderr: string;
  nextOffset: number;
  complete: boolean;
}

export interface WorkspaceTasks {
  runCommand(options: RunCommandOptions): Promise<RunCommandResponse>;
  runCommandSync(options: RunCommandOptions): Promise<RunCommandResult>;
  runCommandAsync(options: RunCommandOptions): Promise<{ taskId: string }>;
  get(taskId: string): Promise<TaskStatus>;
  output(taskId: string, since?: number, max?: number): Promise<TaskOutput>;
  cancel(taskId: string): Promise<{ state: 'canceled' | 'already_finished' }>;
}
