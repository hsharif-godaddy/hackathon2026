/**
 * Factory for creating app ID adapters
 * 
 * Provides the appropriate adapter based on the current environment
 */
import { isV2ControlPlaneEnabled } from '@/lib/control-plane/adapter-factory'
import { logger } from '@/lib/request-context'
import { ApiAppIdAdapter } from './ApiAppIdAdapter'
import { IAppIdAdapter } from './IAppIdAdapter'
import { PassthroughAppIdAdapter } from './PassthroughAppIdAdapter'

export class AppIdAdapterFactory {
  private static _instance: IAppIdAdapter

  /**
   * Get the appropriate app ID adapter for the current environment
   * 
   * @returns An implementation of IAppIdAdapter
   */
  static getInstance(): IAppIdAdapter {
    if (!this._instance) {
      if (isV2ControlPlaneEnabled()) {
        // In V2 mode, we need to handle job ID → app ID transition
        logger.info('app-id-adapter.factory', { adapter: 'api-based', mode: 'v2' })
        this._instance = new ApiAppIdAdapter()
      } else {
        // In legacy mode, we don't need to transform IDs
        logger.info('app-id-adapter.factory', { adapter: 'passthrough', mode: 'legacy' })
        this._instance = new PassthroughAppIdAdapter()
      }
    }
    return this._instance
  }

  /**
   * Reset the adapter instance (for testing)
   */
  static reset(): void {
    this._instance = undefined as unknown as IAppIdAdapter
  }
}
