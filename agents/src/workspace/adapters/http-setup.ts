import type { DevSupervisorClient } from '../../services/DevSupervisorClient.js';
import type { WorkspaceSetup, SetupStatus, SetupExecuteResult } from '../setup.js';

export class HttpSetup implements WorkspaceSetup {
  constructor(private readonly client: DevSupervisorClient) {}

  async getStatus(): Promise<SetupStatus> {
    const raw = await this.client.getSetupStatus();
    return {
      configured: raw.setup_configured,
      deferred: raw.setup_deferred,
      executed: raw.setup_executed,
      running: raw.setup_running,
      error: raw.setup_error,
    };
  }

  async execute(): Promise<SetupExecuteResult> {
    const response = await this.client.executeSetup();
    return response.status;
  }
}
