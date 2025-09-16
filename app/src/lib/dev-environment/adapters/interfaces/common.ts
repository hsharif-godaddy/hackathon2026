import { logger } from '../../../request-context';
/**
 * Common types and enums used across all adapters
 */

import { execSync } from 'child_process';

export type AdapterType = 'docker' | 'process';

export type AppTemplateVersion = 'v1' | 'v2' | 'v3';

export interface AdapterConfig {
  type: AdapterType;
  enabled: boolean;
  settings?: Record<string, any>;
}

export interface TemplateInfo {
  version: AppTemplateVersion;
  path: string;
  supportsDocker: boolean;
  defaultPort: number;
  buildCommand?: string;
  startCommand?: string;
}

/**
 * Standard error types for adapters
 */
export class AdapterError extends Error {
  constructor(
    message: string,
    public code: string,
    public adapter: AdapterType,
    public appId?: string
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export class ContainerError extends AdapterError {
  constructor(message: string, appId?: string) {
    super(message, 'CONTAINER_ERROR', 'docker', appId);
    this.name = 'ContainerError';
  }
}

export class ProcessError extends AdapterError {
  constructor(message: string, appId?: string) {
    super(message, 'PROCESS_ERROR', 'process', appId);
    this.name = 'ProcessError';
  }
}

/**
 * Configuration resolver for different environments
 */
export class AdapterConfigResolver {
  /**
   * Check if Docker is running and available
   */
  private static isDockerAvailable(): boolean {
    try {
      execSync('docker info', { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  static resolveConfig(): AdapterConfig {
    const mode = process.env.LOCAL_ENVIRONMENT_MODE?.toLowerCase() || 'auto';

    switch (mode) {
      case 'docker':
        // Force docker mode - error if not available
        if (!this.isDockerAvailable()) {
          throw new Error('Docker mode explicitly requested but Docker is not available');
        }
        logger.info('🟢 Using explicit docker mode');
        return {
          type: 'docker',
          enabled: true,
          settings: {
            baseImage: 'node:20-alpine',
            networkMode: 'bridge',
            restartPolicy: 'unless-stopped'
          }
        };

      case 'process':
        // Force process mode
        logger.info('🟡 Using explicit process mode');
        return {
          type: 'process',
          enabled: true,
          settings: {
            processTimeout: 30000,
            maxProcesses: 10
          }
        };

      case 'auto':
      default:
        // Auto detection - docker if available, else process
        if (this.isDockerAvailable()) {
          logger.info('🟢 Auto mode: Docker is available, using docker mode');
          return {
            type: 'docker',
            enabled: true,
            settings: {
              baseImage: 'node:20-alpine',
              networkMode: 'bridge',
              restartPolicy: 'unless-stopped'
            }
          };
        } else {
          logger.info('🔴 Auto mode: Docker not available, using process mode');
          return {
            type: 'process',
            enabled: true,
            settings: {
              processTimeout: 30000,
              maxProcesses: 10
            }
          };
        }
    }
  }

  static getAdapterType(): AdapterType {
    return this.resolveConfig().type;
  }

  static isDockerEnabled(): boolean {
    return this.getAdapterType() === 'docker';
  }
}