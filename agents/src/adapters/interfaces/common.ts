/**
 * Common types and enums used across all adapters
 */

import { execSync } from 'child_process';

export type AdapterType = 'docker' | 'local' | 'cloud';

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
    super(message, 'PROCESS_ERROR', 'local', appId);
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
    let docApps = process.env.DOC_APPS?.toLowerCase();

    // If DOC_APPS is undefined, check if Docker is running
    if (docApps === undefined) {
      docApps = this.isDockerAvailable() ? 'true' : 'false';
      console.log('DOC_APPS is undefined, checking Docker availability: ', docApps);
      if (docApps === 'true') {
        console.log('🟢 Docker is available, going with docker mode');
      } else {
        console.log('🔴 Docker is not available, going with local mode');
      }
    }

    const isDockerEnabled = docApps === 'true' || docApps === '1';

    if (isDockerEnabled) {
      return {
        type: 'docker',
        enabled: true,
        settings: {
          baseImage: 'node:20-alpine',
          networkMode: 'bridge',
          restartPolicy: 'unless-stopped'
        }
      };
    }

    // Default to local
    return {
      type: 'local',
      enabled: true,
      settings: {
        processTimeout: 30000,
        maxProcesses: 10
      }
    };
  }

  static getAdapterType(): AdapterType {
    return this.resolveConfig().type;
  }

  static isDockerEnabled(): boolean {
    return this.getAdapterType() === 'docker';
  }
}
