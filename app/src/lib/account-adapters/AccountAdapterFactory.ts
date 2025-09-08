import { ProdAccountAdapter } from './ProdAccountAdapter';
import { DevAccountAdapter } from './DevAccountAdapter';
import type { IAccountAdapter } from './interfaces/IAccountAdapter';

/**
 * Account Adapter Factory
 * 
 * Selects the appropriate account adapter based on environment
 * Similar to SiteAdapterFactory but for account management
 */
export class AccountAdapterFactory {
  private static instance: IAccountAdapter | null = null;

  /**
   * Get account adapter singleton based on environment
   */
  public static getInstance(): IAccountAdapter {
    if (!AccountAdapterFactory.instance) {
      const isProduction = AccountAdapterFactory.isProductionMode();
      
      // DOUBLE SAFETY CHECK: Additional validation before creating dev adapter
      if (!isProduction) {
        AccountAdapterFactory.validateDevEnvironment();
      }
      
      AccountAdapterFactory.instance = isProduction 
        ? new ProdAccountAdapter() 
        : new DevAccountAdapter();
        
      console.log(`🏭 Using ${isProduction ? 'Production' : 'Development'} Account Adapter`);
    }
    return AccountAdapterFactory.instance;
  }

  /**
   * Force reset singleton (useful for testing)
   */
  public static reset(): void {
    AccountAdapterFactory.instance = null;
  }

  /**
   * Detect if we're in production mode based on environment
   */
  private static isProductionMode(): boolean {
    // Use similar logic to SiteAdapterFactory/DeploymentAdapterFactory
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
      hasStripeKey: !!process.env.STRIPE_SECRET_KEY?.includes('sk_live'),
      hasProdDbUrl: process.env.DATABASE_URL?.includes('prod')
    };

    const foundProductionIndicators = Object.entries(productionIndicators)
      .filter(([_, value]) => value)
      .map(([key, _]) => key);

    if (foundProductionIndicators.length > 0) {
      const error = new Error(
        '🚨 FACTORY SAFETY ERROR: Production indicators detected but attempting to create DevAccountAdapter! ' +
        `Found indicators: ${foundProductionIndicators.join(', ')}. ` +
        'Using dev account adapter in production would bypass billing and authentication!'
      );
      
      console.error('🚨 ACCOUNT ADAPTER FACTORY SAFETY VIOLATION:', {
        error: error.message,
        productionIndicators,
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          timestamp: new Date().toISOString()
        }
      });

      throw error;
    }

    console.log('✅ AccountAdapterFactory: Dev environment validation passed');
  }
}