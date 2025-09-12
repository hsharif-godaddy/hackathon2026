/**
 * Prisma-based Account Service
 * Replaces the old SQL-based AccountService with type-safe Prisma operations
 */

import { PrismaClient, AccountStatus } from '@/generated/prisma';
import { v4 as uuidv4 } from 'uuid';

// Singleton Prisma client
let prisma: PrismaClient;

function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

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

  constructor() {
    this.client = getPrismaClient();
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
      console.error('Error finding account by shopper_id:', error);
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
      console.error('Error finding account by customer_id:', error);
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
      console.error('Error creating account:', error);
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
      console.error('Error updating account status:', error);
      return false;
    }
  }

  /**
   * Get or create account for shopper (used in JWT validation)
   */
  async getOrCreateAccount(shopperId: string, customerId?: string): Promise<Account> {
    try {
      // Try to find existing account
      let account = await this.findByShopperId(shopperId);
      
      if (!account) {
        // Create new account if not found, use customerId from JWT if available
        account = await this.createAccount(shopperId, customerId);
      }

      return account;
    } catch (error) {
      console.error('Error getting or creating account:', error);
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
      console.error('Error getting all accounts:', error);
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
      console.error('Error getting account with plan:', error);
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

      console.log(`✅ Created new plan: ${name} (${id})`);
      return this.mapPlanFromPrisma(plan);
    } catch (error) {
      console.error('Error creating plan:', error);
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
      console.error('Error getting all plans:', error);
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