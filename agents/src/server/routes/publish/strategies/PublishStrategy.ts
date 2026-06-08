import type { DevSupervisorClient, PublishRequest, PublishResponse } from '../../../../services/DevSupervisorClient.js';
import type { GitUtils } from '../../../../utils/git.js';
import type { ILogger } from '../../../../logging/types.js';
import type { WorkspaceTasks } from '../../../../workspace/tasks.js';
import type { WorkspaceRuntime } from '../../../../workspace/runtime.js';

export type DeploymentStrategy = 'default' | 'paas';

export interface PublishContext {
  appId: string;
  appPath: string;
  targetDir?: string;
  tasks: WorkspaceTasks;
  gitUtils: GitUtils;
  logger: ILogger;
  runtime?: WorkspaceRuntime;
}

export interface BuildResult {
  commitHash: string;
  archivePath: string;
}

export interface PublishStrategy {
  /**
   * Strategy identifier used for:
   * - Factory selection
   * - Log event formatting: `route.publish.{key}.event`
   */
  readonly key: DeploymentStrategy;

  /**
   * Phase 1: Prepare the build artifact.
   * Creates the deployable archive without making it live.
   *
   * - Default: git ops → build → auto-detect archive
   * - PaaS: build → full source archive (no git ops)
   */
  prepareBuild(context: PublishContext): Promise<BuildResult>;

  /**
   * Phase 2: Deploy to the publish supervisor.
   * Makes the prepared build live. Strategy-specific behavior:
   *
   * - Default: Direct publish call (no recovery)
   * - PaaS: Publish with timeout recovery logic
   */
  deploy(
    publishSupervisor: DevSupervisorClient,
    request: PublishRequest,
    logger: ILogger
  ): Promise<PublishResponse>;
}

// Import strategies for factory function
import { DefaultPublishStrategy } from './DefaultPublishStrategy.js';
import { PaaSPublishStrategy } from './PaaSPublishStrategy.js';

/**
 * Factory function to get the appropriate publish strategy
 *
 * @param strategy - Strategy identifier: 'paas', 'default', or undefined/null
 * @returns The appropriate PublishStrategy implementation
 */
export function getPublishStrategy(strategy?: string | null): PublishStrategy {
  switch (strategy) {
    case 'paas':
      return new PaaSPublishStrategy();
    case 'default':
    case undefined:
    case null:
    default:
      return new DefaultPublishStrategy();
  }
}
