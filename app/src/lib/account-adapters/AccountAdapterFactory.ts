import { DevAccountAdapter } from './DevAccountAdapter';
import type { IAccountAdapter } from './interfaces/IAccountAdapter';
import { ProdAccountAdapter } from './ProdAccountAdapter';
import { logger } from '../request-context';

// Use globalThis to survive Next.js hot module reloading in development
declare global {
  interface GlobalThis {
    __accountAdapter?: IAccountAdapter;
  }
}

/**
 * Account Adapter Factory
 *
 * Selects the appropriate account adapter based on environment
 * Similar to SiteAdapterFactory but for account management
 */
export class AccountAdapterFactory {
  /**
   * Get account adapter singleton based on environment
   */
  public static getInstance(): IAccountAdapter {
    if (!globalThis.__accountAdapter) {
      const isProduction = AccountAdapterFactory.isProductionMode();

      // DOUBLE SAFETY CHECK: Additional validation before creating dev adapter
      if (!isProduction) {
        AccountAdapterFactory.validateDevEnvironment();
      }

      globalThis.__accountAdapter = isProduction
        ? new ProdAccountAdapter()
        : new DevAccountAdapter();

      logger.info('account.adapter.initialized', {
        adapterType: isProduction ? 'production' : 'development'
      });
    }
    return globalThis.__accountAdapter;
  }

  /**
   * Force reset singleton (useful for testing)
   */
  public static reset(): void {
    globalThis.__accountAdapter = undefined;
  }

  /**
   * Detect if we're in production mode based on environment
   */
  private static isProductionMode(): boolean {
    // Check for MySQL via DATABASE_URL or individual env vars (matches DatabaseManager logic)
    const hasDatabaseUrl = process.env.DATABASE_URL?.startsWith('mysql://');
    const hasIndividualMysqlVars = !!process.env.MYSQL_DB_USERNAME;

    return process.env.NODE_ENV === 'production' ||
           hasDatabaseUrl ||                         // DATABASE_URL with MySQL indicates production
           hasIndividualMysqlVars ||                // Individual MySQL vars indicate production
           !!process.env.AWS_REGION_NOMAD ||        // AWS/Nomad indicates production
           !!process.env.PRODUCTION_DOMAIN;         // Production domain set
  }

  /**
   * SAFETY CHECK: Additional validation before using dev adapter
   */
  private static validateDevEnvironment(): void {
    // Check for any production indicators that might have been missed
    const productionIndicators = {
      hasProductionEnv: process.env.NODE_ENV === 'production',
      hasMySQLUrl: process.env.DATABASE_URL?.startsWith('mysql://'),
      hasMySQL: !!process.env.MYSQL_DB_USERNAME,
      hasAWS: !!process.env.AWS_REGION_NOMAD,
      hasProdDomain: !!process.env.PRODUCTION_DOMAIN,
      hasStripeKey: !!process.env.STRIPE_SECRET_KEY?.includes('sk_live'),
      hasProdDbUrl: process.env.DATABASE_URL?.includes('prod')
    };

    const foundProductionIndicators = Object.entries(productionIndicators)
      .filter(([_, value]) => value)
      .map(([key, _]) => key);

    if (foundProductionIndicators.length > 0) {
      const error = new Error(
        'FACTORY SAFETY ERROR: Production indicators detected but attempting to create DevAccountAdapter! ' +
        `Found indicators: ${foundProductionIndicators.join(', ')}. ` +
        'Using dev account adapter in production would bypass billing and authentication!'
      );

      logger.error('account.adapter.factory.safety.violation', {
        message: 'Production indicators found when attempting to use dev adapter',
        error: error.message,
        productionIndicators,
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          timestamp: new Date().toISOString()
        }
      }, { tags: ['security'] });

      throw error;
    }

    logger.info('account.adapter.factory.dev.validated', {
      message: 'Dev environment validation passed'
    });
  }
}
