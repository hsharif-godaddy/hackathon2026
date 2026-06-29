export interface EnvEntry {
  key: string;
  value: string;
  source: 'workspace' | 'inherited';
}

export interface UpsertEnvOptions {
  entries: Array<{ key: string; value: string }>;
  restartRuntime?: boolean;
}

export interface RemoveKeysOptions {
  keys: string[];
  restartRuntime?: boolean;
}

export interface WorkspaceConfig {
  listEnv(): Promise<EnvEntry[]>;
  upsertEnv(options: UpsertEnvOptions): Promise<{ updated: string[] }>;
  removeEnv(options: RemoveKeysOptions): Promise<{ removed: string[] }>;
}
