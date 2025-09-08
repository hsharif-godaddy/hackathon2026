/**
 * Account Adapter Interface
 * 
 * Defines the contract for managing user accounts and plans in both production and development environments.
 * Production uses real database operations, development uses mock data.
 */

export interface AccountInfo {
  id: string;
  shopper_id: string;
  customer_id: string;
  status: 'active' | 'suspended' | 'closed';
  plan_id?: string;
  plan_name?: string;
  plan_site_limit?: number;
  plan_price?: number;
  created_at: string;
  updated_at: string;
}

export interface PlanInfo {
  id: string;
  name: string;
  site_limit: number;
  price: number;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAccountRequest {
  shopperId: string;
  customerId: string;
}

export interface UpdateAccountRequest {
  status?: 'active' | 'suspended' | 'closed';
}

export interface IAccountAdapter {
  /**
   * Get account by shopper ID
   */
  getAccountByShopperId(shopperId: string): Promise<AccountInfo | null>;
  
  /**
   * Get account with plan details
   */
  getAccountWithPlan(shopperId: string): Promise<AccountInfo | null>;
  
  /**
   * Create a new account
   */
  createAccount(shopperId: string, customerId: string): Promise<AccountInfo>;
  
  /**
   * Update account status
   */
  updateAccountStatus(shopperId: string, status: string): Promise<boolean>;
  
  /**
   * Get all available plans
   */
  getAllPlans(): Promise<PlanInfo[]>;
  
  /**
   * Check if this adapter handles real authentication
   */
  requiresAuth(): boolean;
  
  /**
   * Get adapter capabilities
   */
  getCapabilities(): {
    supportsRealBilling: boolean;
    supportsMultiplePlans: boolean;
    supportsPlanChanges: boolean;
  };
}