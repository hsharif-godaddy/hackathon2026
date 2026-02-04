/**
 * Prisma-based Account Service
 * Replaces the old SQL-based AccountService with type-safe Prisma operations
 */

import { v4 as uuidv4 } from 'uuid';

import { AccountStatus, PrismaClient } from '@/generated/prisma';
import { getPrismaClient } from '@/lib/prisma';
import { logger } from '../request-context';

export interface Account {
  id: string;
  shopper_id: string;
  customer_id: string;
  plan_id: string | null;
  status: 'active' | 'suspended' | 'closed';
  created_at: Date;
  updated_at: Date;
}

export interface Plan {
  id: string;
  name: string;
  site_limit: number;
  price: number;
  created_at: Date;
  updated_at: Date;
}

export class PrismaAccountService {
  private client: PrismaClient;
  private defaultPlanIdCache: string | null = null;

  constructor() {
    this.client = getPrismaClient();
  }

  /**
   * Get default plan ID (cached to avoid repeated queries on hot auth path)
   */
  private async getDefaultPlanId(): Promise<string> {
    if (this.defaultPlanIdCache) {
      return this.defaultPlanIdCache;
    }

    const defaultPlan = await this.client.plans.findUnique({
      where: { name: 'Free' },
    });

    // Fallback to a stable, hardcoded UUID so that we always have a deterministic
    // default plan ID even if the "Free" plan record is missing (e.g. in tests or
    // misconfigured environments). This value must remain in sync with any seeded
    // "Free" plan ID used elsewhere in the system.
    this.defaultPlanIdCache = defaultPlan?.id || '550e8400-e29b-41d4-a716-446655440001';
    return this.defaultPlanIdCache;
  }

  /**
   * Find account by shopper_id
   */
  async findByShopperId(shopperId: string): Promise<Account | null> {
    try {
      const account = await this.client.accounts.findUnique({
        where: { shopper_id: shopperId },
      });
      
      return account ? this.mapAccountFromPrisma(account) : null;
    } catch (error) {
      logger.error('account.findByShopperId.error', {
        message: 'Error finding account by shopper_id',
        shopperId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Find account by customer_id (our internal ID)
   */
  async findByCustomerId(customerId: string): Promise<Account | null> {
    try {
      const account = await this.client.accounts.findUnique({
        where: { customer_id: customerId },
      });
      
      return account ? this.mapAccountFromPrisma(account) : null;
    } catch (error) {
      logger.error('account.findByCustomerId.error', {
        message: 'Error finding account by customer_id',
        customerId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Create a new account for a shopper
   */
  async createAccount(shopperId: string, customerId?: string): Promise<Account> {
    try {
      const id = uuidv4();
      
      // Use customer ID from JWT if provided, otherwise generate one
      let finalCustomerId: string;
      if (customerId) {
        finalCustomerId = customerId;
      } else {
        finalCustomerId = `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      }
      
      // Get default plan ID
      const defaultPlan = await this.client.plans.findUnique({
        where: { name: 'Free' },
      });

      const planId = defaultPlan?.id || '550e8400-e29b-41d4-a716-446655440001';

      const account = await this.client.accounts.create({
        data: {
          id,
          shopper_id: shopperId,
          customer_id: finalCustomerId,
          plan_id: planId,
          status: AccountStatus.active,
        },
      });

      return this.mapAccountFromPrisma(account);
    } catch (error) {
      logger.error('account.create.error', {
        message: 'Error creating account',
        shopperId,
        customerId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update account status
   */
  async updateAccountStatus(shopperId: string, status: 'active' | 'suspended' | 'closed'): Promise<boolean> {
    try {
      const result = await this.client.accounts.update({
        where: { shopper_id: shopperId },
        data: { status: status as AccountStatus },
      });
      return !!result;
    } catch (error) {
      logger.error('account.updateStatus.error', {
        message: 'Error updating account status',
        shopperId,
        status,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get or create account for shopper (idempotent - safe for concurrent calls)
   *
   * Uses Prisma upsert to handle race conditions during account creation.
   * Safe to call concurrently - will not throw unique constraint errors on shopper_id.
   *
   * IMPORTANT: If customer_id from JWT doesn't match existing account's customer_id,
   * this indicates a data integrity issue and will throw an error.
   *
   * @param shopperId - Shopper ID from JWT (unique key for upsert)
   * @param customerId - Customer ID from JWT (always present in JWT)
   * @returns Existing or newly created account
   * @throws Error if customer_id mismatch detected (security/data integrity issue)
   */
  async getOrCreateAccount(shopperId: string, customerId: string): Promise<Account> {
    try {
      // Get default plan ID (cached to avoid per-request query)
      const planId = await this.getDefaultPlanId();

      // Upsert on shopper_id (unique constraint)
      // If account exists: return existing account unchanged
      // If not exists: create new account with JWT values
      const account = await this.client.accounts.upsert({
        where: { shopper_id: shopperId },
        update: {
          // On existing account, don't change any data
          // Empty update block - Prisma will still fetch the account
        },
        create: {
          id: uuidv4(),
          shopper_id: shopperId,
          customer_id: customerId,
          plan_id: planId,
          status: AccountStatus.active,
        },
      });

      // SECURITY: Validate customer_id matches JWT
      // If existing account has different customer_id, this is a data integrity issue
      if (account.customer_id !== customerId) {
        logger.error('account.customer_id.mismatch', {
          message: 'Customer ID mismatch - JWT cid does not match stored account',
          shopperId,
          jwtCustomerId: customerId,
          storedCustomerId: account.customer_id,
          accountId: account.id
        }, { tags: ['security'] });

        throw new Error(
          `Account data integrity error: customer_id mismatch for shopper ${shopperId}. ` +
          `This may indicate an upstream identity issue.`
        );
      }

      // NOTE: We cannot reliably determine if an account is newly created by comparing timestamps.
      // The upsert's update block is empty, so updated_at is not modified for existing accounts.
      // Database triggers, clock precision, or concurrent updates could cause timestamp differences
      // even for new records. For observability purposes, we log this operation without claiming
      // to know whether the account was just created or already existed.
      logger.info('account.getOrCreate.success', {
        accountId: account.id,
        shopperId,
        customerId
      }, { tags: ['security'] });

      return this.mapAccountFromPrisma(account);
    } catch (error) {
      logger.error('account.getOrCreate.error', {
        message: 'Failed to get or create account',
        shopperId,
        customerId,
        error: error instanceof Error ? error.message : String(error)
      }, { tags: ['security'] });
      throw error;
    }
  }

  /**
   * Get all accounts (for admin purposes)
   */
  async getAllAccounts(): Promise<Account[]> {
    try {
      const accounts = await this.client.accounts.findMany({
        orderBy: { created_at: 'desc' },
      });
      
      return accounts.map(account => this.mapAccountFromPrisma(account));
    } catch (error) {
      logger.error('account.getAll.error', {
        message: 'Error getting all accounts',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get account with plan details
   */
  async getAccountWithPlan(shopperId: string): Promise<(Account & { 
    plan_name?: string; 
    plan_site_limit?: number; 
    plan_price?: number; 
  }) | null> {
    try {
      const account = await this.client.accounts.findUnique({
        where: { shopper_id: shopperId },
      });

      if (!account) {
        return null;
      }

      const mappedAccount = this.mapAccountFromPrisma(account);
      
      // If account has a plan_id, fetch the plan details separately
      if (account.plan_id) {
        const plan = await this.client.plans.findUnique({
          where: { id: account.plan_id },
        });
        
        return {
          ...mappedAccount,
          plan_name: plan?.name,
          plan_site_limit: plan?.site_limit,
          plan_price: plan?.price ? Number(plan.price) : undefined,
        };
      }
      
      return mappedAccount;
    } catch (error) {
      logger.error('account.getWithPlan.error', {
        message: 'Error getting account with plan',
        shopperId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Create a new plan (for admin purposes)
   */
  async createPlan(name: string, siteLimit: number, price: number): Promise<Plan> {
    try {
      const id = uuidv4();
      
      const plan = await this.client.plans.create({
        data: {
          id,
          name,
          site_limit: siteLimit,
          price,
        },
      });

      logger.info('plan.create.success', {
        planId: id,
        name,
        siteLimit,
        price
      });
      return this.mapPlanFromPrisma(plan);
    } catch (error) {
      logger.error('plan.create.error', {
        message: 'Error creating plan',
        name,
        siteLimit,
        price,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get all plans (for admin/frontend usage)
   */
  async getAllPlans(): Promise<Plan[]> {
    try {
      const plans = await this.client.plans.findMany({
        orderBy: { price: 'asc' },
      });
      
      return plans.map(plan => this.mapPlanFromPrisma(plan));
    } catch (error) {
      logger.error('plan.getAll.error', {
        message: 'Error getting all plans',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Map Prisma account object to our Account interface
   */
  private mapAccountFromPrisma(prismaAccount: any): Account {
    return {
      id: prismaAccount.id,
      shopper_id: prismaAccount.shopper_id,
      customer_id: prismaAccount.customer_id,
      plan_id: prismaAccount.plan_id,
      status: prismaAccount.status,
      created_at: prismaAccount.created_at,
      updated_at: prismaAccount.updated_at,
    };
  }

  /**
   * Map Prisma plan object to our Plan interface
   */
  private mapPlanFromPrisma(prismaPlan: any): Plan {
    return {
      id: prismaPlan.id,
      name: prismaPlan.name,
      site_limit: prismaPlan.site_limit,
      price: Number(prismaPlan.price),
      created_at: prismaPlan.created_at,
      updated_at: prismaPlan.updated_at,
    };
  }

  /**
   * Close the Prisma connection (useful for testing)
   */
  async disconnect(): Promise<void> {
    await this.client.$disconnect();
  }
}

// Export a default instance for convenience
export const prismaAccountService = new PrismaAccountService();