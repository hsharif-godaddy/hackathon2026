/**
 * Common types and enums used across all adapters
 */

import { execSync } from 'child_process';

export type AdapterType = 'docker';

export type AppTemplateVersion = 'v8';

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
    super(message, 'PROCESS_ERROR', 'docker', appId);
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
    if (!this.isDockerAvailable()) {
      throw new Error('Docker is required but not available. Please ensure Docker is installed and running.');
    }
    
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

  static getAdapterType(): AdapterType {
    return this.resolveConfig().type;
  }

  static isDockerEnabled(): boolean {
    return this.getAdapterType() === 'docker';
  }
}