export interface SetupStatus {
  configured: boolean;
  deferred: boolean;
  executed: boolean;
  running: boolean;
  error: string | null;
}

export type SetupExecuteResult = 'executed' | 'already_executed' | 'not_configured';

export interface WorkspaceSetup {
  getStatus(): Promise<SetupStatus>;
  execute(): Promise<SetupExecuteResult>;
}
