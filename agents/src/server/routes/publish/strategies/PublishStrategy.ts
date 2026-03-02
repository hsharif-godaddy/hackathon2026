import type { DevSupervisorClient } from '../../../../services/DevSupervisorClient.js';
import type { GitUtils } from '../../../../utils/git.js';
import type { log } from '../../../../logging/index.js';

export type DeploymentStrategy = 'default' | 'paas';

export interface PublishContext {
  appId: string;
  appPath: string;
  targetDir?: string;
  devSupervisor: DevSupervisorClient;
  gitUtils: GitUtils;
  logger: ReturnType<typeof log.forApp>;
}

export interface PublishResult {
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
   * Execute the complete publish workflow.
   * Each strategy owns its entire workflow internally.
   *
   * - Default: git ops → build → auto-detect archive
   * - PaaS: build → full source archive (no git ops)
   */
  publish(context: PublishContext): Promise<PublishResult>;
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
