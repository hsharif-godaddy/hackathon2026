import { PrismaAccountService } from '@/lib/database/prisma-account-service';
import type { AccountInfo, IAccountAdapter, PlanInfo } from './interfaces/IAccountAdapter';

/**
 * Production Account Adapter
 * 
 * Manages accounts using production services (database, real billing)
 * Wraps the existing AccountService to match the adapter interface
 */
export class ProdAccountAdapter implements IAccountAdapter {
  private accountService: PrismaAccountService;

  constructor() {
    this.accountService = new PrismaAccountService();
  }

  async getAccountByShopperId(shopperId: string): Promise<AccountInfo | null> {
    const account = await this.accountService.findByShopperId(shopperId);
    
    if (!account) {
      return null;
    }

    return this.mapToAccountInfo(account);
  }

  async getAccountWithPlan(shopperId: string): Promise<AccountInfo | null> {
    const account = await this.accountService.getAccountWithPlan(shopperId);
    
    if (!account) {
      return null;
    }

    return this.mapToAccountInfo(account);
  }

  async createAccount(shopperId: string, customerId: string): Promise<AccountInfo> {
    const account = await this.accountService.createAccount(shopperId, customerId);
    return this.mapToAccountInfo(account);
  }

  async updateAccountStatus(shopperId: string, status: string): Promise<boolean> {
    return await this.accountService.updateAccountStatus(shopperId, status as 'active' | 'suspended' | 'closed');
  }

  async getAllPlans(): Promise<PlanInfo[]> {
    const plans = await this.accountService.getAllPlans();
    return plans.map(plan => this.mapToPlanInfo(plan));
  }

  requiresAuth(): boolean {
    return true; // Production requires authentication
  }

  getCapabilities() {
    return {
      supportsRealBilling: true,
      supportsMultiplePlans: true,
      supportsPlanChanges: true
    };
  }

  private mapToAccountInfo(account: any): AccountInfo {
    return {
      id: account.id,
      shopper_id: account.shopper_id,
      customer_id: account.customer_id,
      status: account.status,
      plan_id: account.plan_id,
      plan_name: account.plan_name,
      plan_site_limit: account.plan_site_limit,
      plan_price: account.plan_price,
      created_at: account.created_at instanceof Date ? account.created_at.toISOString() : account.created_at,
      updated_at: account.updated_at instanceof Date ? account.updated_at.toISOString() : account.updated_at
    };
  }

  private mapToPlanInfo(plan: any): PlanInfo {
    return {
      id: plan.id,
      name: plan.name,
      site_limit: plan.site_limit,
      price: plan.price,
      description: plan.description,
      created_at: plan.created_at instanceof Date ? plan.created_at.toISOString() : plan.created_at,
      updated_at: plan.updated_at instanceof Date ? plan.updated_at.toISOString() : plan.updated_at
    };
  }
}