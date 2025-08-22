import type { IAppAdapter, IAppAdapterFactory } from './interfaces/IAppAdapter.js';
import type { AdapterType } from './interfaces/common.js';
import { AdapterConfigResolver, AdapterError } from './interfaces/common.js';
import { DockerAppService } from './services/DockerAppService.js';
import { LocalAppService } from './services/LocalAppService.js';

/**
 * Factory for creating appropriate app adapters based on configuration
 * Supports Docker, Local, and future Cloud adapters
 */
export class AppAdapterFactory implements IAppAdapterFactory {
  private static instance: AppAdapterFactory;
  private currentAdapter: IAppAdapter | null = null;

  private constructor() {}

  /**
   * Get singleton instance of the factory
   */
  static getInstance(): AppAdapterFactory {
    if (!AppAdapterFactory.instance) {
      AppAdapterFactory.instance = new AppAdapterFactory();
    }
    return AppAdapterFactory.instance;
  }

  /**
   * Create and return the appropriate adapter based on environment configuration
   */
  async createAdapter(): Promise<IAppAdapter> {
    // Return existing adapter if already created and initialized
    if (this.currentAdapter) {
      return this.currentAdapter;
    }

    const adapterType = this.getAdapterType();
    console.log(`🏭 Creating ${adapterType} adapter...`);

    try {
      let adapter: IAppAdapter;

      switch (adapterType) {
        case 'docker':
          adapter = new DockerAppService();
          break;
          
        case 'local':
          adapter = new LocalAppService();
          break;
          
        case 'cloud':
          // Future implementation for cloud providers (AWS, GCP, etc.)
          throw new AdapterError(
            'Cloud adapter not yet implemented', 
            'NOT_IMPLEMENTED', 
            'cloud'
          );
          
        default:
          throw new AdapterError(
            `Unknown adapter type: ${adapterType}`, 
            'UNKNOWN_ADAPTER', 
            adapterType
          );
      }

      // Initialize the adapter
      await adapter.initialize();
      
      // Cache the adapter
      this.currentAdapter = adapter;
      
      console.log(`✅ ${adapterType} adapter created and initialized successfully`);
      return adapter;

    } catch (error) {
      console.error(`❌ Failed to create ${adapterType} adapter:`, error);
      throw error;
    }
  }

  /**
   * Get the current adapter type based on environment configuration
   */
  getAdapterType(): AdapterType {
    return AdapterConfigResolver.getAdapterType();
  }

  /**
   * Check if Docker mode is enabled
   */
  isDockerMode(): boolean {
    return AdapterConfigResolver.isDockerEnabled();
  }

  /**
   * Get current adapter (if any)
   */
  getCurrentAdapter(): IAppAdapter | null {
    return this.currentAdapter;
  }

  /**
   * Reset the factory (useful for testing or configuration changes)
   */
  async reset(): Promise<void> {
    if (this.currentAdapter) {
      try {
        await this.currentAdapter.cleanup();
      } catch (error) {
        console.error('❌ Error during adapter cleanup:', error);
      }
      this.currentAdapter = null;
    }
  }

  /**
   * Get adapter info for debugging/monitoring
   */
  getAdapterInfo() {
    const adapterType = this.getAdapterType();
    const config = AdapterConfigResolver.resolveConfig();
    
    return {
      type: adapterType,
      isInitialized: !!this.currentAdapter,
      config,
      capabilities: this.currentAdapter?.getCapabilities() || null,
      environmentVariable: process.env.DOC_APPS || 'unset'
    };
  }
}

/**
 * Convenience function to get a configured adapter
 */
export async function getAppAdapter(): Promise<IAppAdapter> {
  const factory = AppAdapterFactory.getInstance();
  return await factory.createAdapter();
}

/**
 * Convenience function to check adapter type
 */
export function getAdapterType(): AdapterType {
  const factory = AppAdapterFactory.getInstance();
  return factory.getAdapterType();
}

/**
 * Convenience function to check if Docker mode is enabled
 */
export function isDockerMode(): boolean {
  const factory = AppAdapterFactory.getInstance();
  return factory.isDockerMode();
}
