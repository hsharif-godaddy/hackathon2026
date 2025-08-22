/**
 * Common types and enums used across all adapters
 */

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
  static resolveConfig(): AdapterConfig {
    const docApps = process.env.DOC_APPS?.toLowerCase();
    const isDockerEnabled = docApps === 'true' || docApps === '1' || docApps === undefined;
    
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
