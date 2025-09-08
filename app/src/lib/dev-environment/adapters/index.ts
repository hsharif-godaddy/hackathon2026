import { AdapterConfigResolver, type AdapterType } from './interfaces/common';
import type { IAppAdapter } from './interfaces/IAppAdapter';
import type { DevDatabase } from '../database/DevDatabase';

/**
 * Factory function to create the appropriate adapter based on environment
 */
export async function createAppAdapter(devDb: DevDatabase): Promise<IAppAdapter> {
  const adapterType = AdapterConfigResolver.getAdapterType();
  
  console.log(`🔧 Creating ${adapterType} adapter...`);

  if (adapterType === 'docker') {
    // Dynamically import Docker adapter to avoid loading it in process mode
    const { DockerAppService } = await import('./DockerAppService');
    return new DockerAppService(devDb);
  } else {
    // Dynamically import Process adapter (formerly Local)
    const { LocalAppService } = await import('./LocalAppService');
    return new LocalAppService(devDb);
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