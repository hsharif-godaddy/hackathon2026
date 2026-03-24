/**
 * Factory for creating app ID adapters
 *
 * Always uses the API-based adapter for job ID → app ID resolution.
 */
import { logger } from '@/lib/request-context'
import { ApiAppIdAdapter } from './ApiAppIdAdapter'
import { IAppIdAdapter } from './IAppIdAdapter'

export class AppIdAdapterFactory {
  private static _instance: IAppIdAdapter

  /**
   * Get the app ID adapter (API-based, handles job ID → app ID transition)
   *
   * @returns An implementation of IAppIdAdapter
   */
  static getInstance(): IAppIdAdapter {
    if (!this._instance) {
      logger.info('app-id-adapter.factory', { adapter: 'api-based' })
      this._instance = new ApiAppIdAdapter()
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
