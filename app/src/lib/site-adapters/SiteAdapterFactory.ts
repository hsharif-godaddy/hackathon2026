import { logger } from '../request-context';
import { DevSiteAdapter } from './DevSiteAdapter';
import { ProdSiteAdapter } from './ProdSiteAdapter';
import type { ISiteAdapter } from './interfaces/ISiteAdapter';

/**
 * Site Adapter Factory
 *
 * Determines which site adapter to use based on environment
 */
export class SiteAdapterFactory {
  private static _instance: ISiteAdapter | null = null;

  /**
   * Get the appropriate site adapter for the current environment
   */
  static getInstance(): ISiteAdapter {
    if (!this._instance) {
      const isProduction = this.isProductionMode();

      // DOUBLE SAFETY CHECK: Additional validation before creating dev adapter
      if (!isProduction) {
        this.validateDevEnvironment();
      }

      if (isProduction) {
        logger.info('🏭 Using ProdSiteAdapter for production environment');
        this._instance = new ProdSiteAdapter();
      } else {
        logger.info('🔧 Using DevSiteAdapter for development environment');
        this._instance = new DevSiteAdapter();
      }
    }

    return this._instance;
  }

  /**
   * Reset the instance (useful for testing)
   */
  static reset(): void {
    this._instance = null;
  }

  /**
   * Comprehensive production mode detection
   */
  private static isProductionMode(): boolean {
    return process.env.NODE_ENV === 'production' ||
           !!process.env.MYSQL_DB_USERNAME ||        // MySQL indicates production
           !!process.env.AWS_REGION_NOMAD ||         // AWS/Nomad indicates production
           !!process.env.PRODUCTION_DOMAIN;         // Production domain set
  }

  /**
   * SAFETY CHECK: Additional validation before using dev adapter
   */
  private static validateDevEnvironment(): void {
    // Check for any production indicators that might have been missed
    const productionIndicators = {
      hasProductionEnv: process.env.NODE_ENV === 'production',
      hasMySQL: !!process.env.MYSQL_DB_USERNAME,
      hasAWS: !!process.env.AWS_REGION_NOMAD,
      hasProdDomain: !!process.env.PRODUCTION_DOMAIN,
      hasProductionDbUrl: process.env.DATABASE_URL?.includes('prod'),
      hasProductionApiKey: process.env.OPENAI_API_KEY?.includes('prod')
    };

    const foundProductionIndicators = Object.entries(productionIndicators)
      .filter(([_, value]) => value)
      .map(([key, _]) => key);

    if (foundProductionIndicators.length > 0) {
      const error = new Error(
        '🚨 FACTORY SAFETY ERROR: Production indicators detected but attempting to create DevSiteAdapter! ' +
        `Found indicators: ${foundProductionIndicators.join(', ')}. ` +
        'This could indicate misconfigured environment variables.'
      );

      logger.error('🚨 SITE ADAPTER FACTORY SAFETY VIOLATION:', {
        error: error.message,
        productionIndicators,
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          timestamp: new Date().toISOString()
        }
      });

      throw error;
    }

    logger.info('✅ SiteAdapterFactory: Dev environment validation passed');
  }

  /**
   * Check if current environment is development
   */
  static isDevelopment(): boolean {
    return !this.isProductionMode();
  }

  /**
   * Get the local environment mode
   */
  static getLocalEnvironmentMode(): string {
    return process.env.LOCAL_ENVIRONMENT_MODE?.toLowerCase() || 'auto';
  }
}
