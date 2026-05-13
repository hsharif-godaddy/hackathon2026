import type { DevSupervisorClient } from '../../services/DevSupervisorClient.js';
import type {
  WorkspaceDeployments,
  DeployOptions,
  DeployResult,
  DeploymentStatus,
  PrepareOptions,
  PrepareResult,
  StatusOptions,
} from '../deployments.js';
import type { WorkspaceVariant } from '../variant.js';
import { VariantNotApplicableError, WorkspaceNotImplementedError } from '../errors.js';
import { parseDurationToSeconds } from './duration.js';
import { safeDate } from './wire.js';

export class HttpDeployments implements WorkspaceDeployments {
  constructor(
    private readonly client: DevSupervisorClient,
    private readonly variant: WorkspaceVariant,
  ) {}

  async prepare(_options?: PrepareOptions): Promise<PrepareResult> {
    if (this.variant !== 'preview') {
      throw new VariantNotApplicableError('deployments.prepare', this.variant);
    }
    throw new WorkspaceNotImplementedError('deployments.prepare');
  }

  async activate(_options: DeployOptions): Promise<DeployResult> {
    if (this.variant !== 'publish') {
      throw new VariantNotApplicableError('deployments.activate', this.variant);
    }
    throw new WorkspaceNotImplementedError('deployments.activate');
  }

  async status(options?: StatusOptions): Promise<DeploymentStatus> {
    if (this.variant !== 'publish') {
      throw new VariantNotApplicableError('deployments.status', this.variant);
    }
    const response = await this.client.getPublishStatus({
      includeLogs: options?.includeLogs,
      lines: options?.logLines,
    });

    const uptimeSeconds = parseDurationToSeconds(response.process.uptime);
    return {
      version: response.version,
      health: response.health,
      process: {
        state: response.process.state,
        pid: response.process.pid,
        startedAt:
          uptimeSeconds > 0 ? new Date(Date.now() - uptimeSeconds * 1000) : undefined,
      },
      logs: response.logs?.map((l) => ({
        timestamp: safeDate(l.timestamp) ?? new Date(0),
        source: l.source,
        message: l.message,
      })),
      warnings: response.warnings,
    };
  }

  async unpublish(): Promise<{ status: 'success' | 'not_published' }> {
    if (this.variant !== 'publish') {
      throw new VariantNotApplicableError('deployments.unpublish', this.variant);
    }
    const response = await this.client.unpublish();
    return { status: response.status };
  }
}
