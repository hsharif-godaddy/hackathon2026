import type { IAccountAdapter, AccountInfo, PlanInfo } from './interfaces/IAccountAdapter';

/**
 * Development Account Adapter
 * 
 * Provides mock account and plan data for development environments
 * Does not require real authentication or billing systems
 */
export class DevAccountAdapter implements IAccountAdapter {

  constructor() {
    // SAFETY CHECK: Prevent usage in production environments
    this.validateDevelopmentEnvironment();
  }
  
  private mockPlans: PlanInfo[] = [
    {
      id: 'dev-free',
      name: 'Development Free',
      site_limit: 999,
      price: 0,
      description: 'Unlimited sites for development',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    },
    {
      id: 'dev-pro',
      name: 'Development Pro',
      site_limit: 9999,
      price: 0,
      description: 'Unlimited sites for development (pro features)',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
  ];

  async getAccountByShopperId(shopperId: string): Promise<AccountInfo | null> {
    // In development, always return a mock account
    return this.createMockAccount(shopperId);
  }

  async getAccountWithPlan(shopperId: string): Promise<AccountInfo | null> {
    // In development, always return a mock account with the free plan
    const mockAccount = this.createMockAccount(shopperId);
    const freePlan = this.mockPlans[0];
    
    return {
      ...mockAccount,
      plan_id: freePlan.id,
      plan_name: freePlan.name,
      plan_site_limit: freePlan.site_limit,
      plan_price: freePlan.price
    };
  }

  async createAccount(shopperId: string, customerId: string): Promise<AccountInfo> {
    // In development, account creation always succeeds
    console.log('🔧 Creating mock account for development:', { shopperId, customerId });
    return this.createMockAccount(shopperId, customerId);
  }

  async updateAccountStatus(shopperId: string, status: string): Promise<boolean> {
    // In development, account updates always succeed
    console.log('🔧 Updating mock account status for development:', { shopperId, status });
    return true;
  }

  async getAllPlans(): Promise<PlanInfo[]> {
    // Return mock plans for development
    return this.mockPlans;
  }

  requiresAuth(): boolean {
    return false; // Development doesn't require real authentication
  }

  getCapabilities() {
    return {
      supportsRealBilling: false,
      supportsMultiplePlans: false, // Only mock plans
      supportsPlanChanges: false // No real plan management in dev
    };
  }

  /**
   * SAFETY CHECK: Validate that this adapter is only used in development environments
   */
  private validateDevelopmentEnvironment(): void {
    const isProduction = 
      process.env.NODE_ENV === 'production' ||
      !!process.env.MYSQL_DB_USERNAME ||        // MySQL indicates production
      !!process.env.AWS_REGION_NOMAD ||         // AWS/Nomad indicates production
      !!process.env.PRODUCTION_DOMAIN;         // Production domain set

    if (isProduction) {
      const error = new Error(
        '🚨 SECURITY ERROR: DevAccountAdapter cannot be used in production environments! ' +
        'This adapter provides mock billing data and bypasses authentication, ' +
        'which would create serious security and financial risks in production.'
      );
      
      // Log the error for monitoring systems
      console.error('🚨 CRITICAL SECURITY VIOLATION:', {
        error: error.message,
        adapter: 'DevAccountAdapter',
        environment: {
          NODE_ENV: process.env.NODE_ENV,
          hasMySQL: !!process.env.MYSQL_DB_USERNAME,
          hasAWS: !!process.env.AWS_REGION_NOMAD,
          hasProdDomain: !!process.env.PRODUCTION_DOMAIN
        },
        timestamp: new Date().toISOString(),
        stackTrace: error.stack
      });

      throw error;
    }

    console.log('✅ DevAccountAdapter: Environment validation passed - running in development mode');
  }

  private createMockAccount(shopperId: string, customerId?: string): AccountInfo {
    return {
      id: `dev-account-${shopperId}`,
      shopper_id: shopperId,
      customer_id: customerId || `dev-customer-${shopperId}`,
      status: 'active',
      plan_id: 'dev-free',
      plan_name: 'Development Free',
      plan_site_limit: 999,
      plan_price: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }
}