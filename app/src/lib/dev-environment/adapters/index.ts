import { AdapterConfigResolver, type AdapterType } from './interfaces/common';
import type { IAppAdapter } from './interfaces/IAppAdapter';
import type { DevDatabase } from '../database/DevDatabase';
import { logger } from '@/lib/request-context';

/**
 * Factory function to create the appropriate adapter based on environment
 */
export async function createAppAdapter(devDb: DevDatabase): Promise<IAppAdapter> {
  const adapterType = AdapterConfigResolver.getAdapterType();
  
  logger.info('adapters.create', { message: `Creating ${adapterType} adapter` });

  if (adapterType === 'docker') {
    const { DockerAppService } = await import('./DockerAppService');
    return new DockerAppService(devDb);
  } else {
    throw new Error(`Unsupported adapter type: ${adapterType}. Only 'docker' is supported.`);
  }
}

/**
 * Get the current adapter type without creating an adapter
 */
export function getAdapterType(): AdapterType {
  return AdapterConfigResolver.getAdapterType();
}

/**
 * Check if Docker mode is enabled
 */
export function isDockerMode(): boolean {
  return AdapterConfigResolver.isDockerEnabled();
}

/**
 * Get adapter configuration
 */
export function getAdapterConfig() {
  return AdapterConfigResolver.resolveConfig();
}

// Re-export types and interfaces
export type { IAppAdapter, ServerInfo, ServerStatus, AppAdapterCapabilities } from './interfaces/IAppAdapter';
export type { AdapterType, AdapterConfig } from './interfaces/common';
export { AdapterConfigResolver, AdapterError, ContainerError, ProcessError } from './interfaces/common';