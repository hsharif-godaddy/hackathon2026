import type {
  WorkspaceConfig,
  EnvEntry,
  UpsertEnvOptions,
  RemoveKeysOptions,
} from '../config.js';
import type { WorkspaceVariant } from '../variant.js';
import { VariantNotApplicableError, WorkspaceNotImplementedError } from '../errors.js';

export class HttpConfig implements WorkspaceConfig {
  constructor(private readonly variant: WorkspaceVariant) {}

  private ensureMutationAllowed(method: string): void {
    if (this.variant === 'publish') {
      throw new VariantNotApplicableError(method, this.variant);
    }
  }

  async listEnv(): Promise<EnvEntry[]> {
    throw new WorkspaceNotImplementedError('config.listEnv');
  }
  async upsertEnv(_options: UpsertEnvOptions): Promise<{ updated: string[] }> {
    this.ensureMutationAllowed('config.upsertEnv');
    throw new WorkspaceNotImplementedError('config.upsertEnv');
  }
  async removeEnv(_options: RemoveKeysOptions): Promise<{ removed: string[] }> {
    this.ensureMutationAllowed('config.removeEnv');
    throw new WorkspaceNotImplementedError('config.removeEnv');
  }
}
