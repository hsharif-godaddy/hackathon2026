import { logger } from '../request-context';
import { v4 as uuidv4 } from 'uuid';
import DatabaseManager from './connection';

export interface Account {
  id: string;
  shopper_id: string;
  customer_id: string;
  plan_id: string | null;
  status: 'active' | 'suspended' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  name: string;
  site_limit: number;
  price: number;
  created_at: string;
  updated_at: string;
}

export class AccountService {
  private db: DatabaseManager;

  constructor() {
    this.db = DatabaseManager.getInstance();
  }

  /**
   * Find account by shopper_id
   */
  async findByShopperId(shopperId: string): Promise<Account | null> {
    try {
      const account = await this.db.get<Account>(
        'SELECT * FROM accounts WHERE shopper_id = ?',
        [shopperId]
      );
      
      return account || null;
    } catch (error) {
      logger.error('Error finding account by shopper_id:', error);
      throw error;
    }
  }

  /**
   * Find account by customer_id (our internal ID)
   */
  async findByCustomerId(customerId: string): Promise<Account | null> {
    try {
      const account = await this.db.get<Account>(
        'SELECT * FROM accounts WHERE customer_id = ?',
        [customerId]
      );
      return account || null;
    } catch (error) {
      logger.error('Error finding account by customer_id:', error);
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
      const defaultPlan = await this.db.get<Plan>(
        'SELECT id FROM plans WHERE name = ?',
        ['Free']
      );

      const planId = defaultPlan?.id || '550e8400-e29b-41d4-a716-446655440001';

      await this.db.run(
        `INSERT INTO accounts (id, shopper_id, customer_id, plan_id, status)
         VALUES (?, ?, ?, ?, ?)`,
        [id, shopperId, finalCustomerId, planId, 'active']
      );

      const newAccount = await this.db.get<Account>(
        'SELECT * FROM accounts WHERE id = ?',
        [id]
      );

      if (!newAccount) {
        throw new Error('Failed to create account');
      }

      return newAccount;
    } catch (error) {
      logger.error('Error creating account:', error);
      throw error;
    }
  }

  /**
   * Update account status
   */
  async updateAccountStatus(shopperId: string, status: 'active' | 'suspended' | 'closed'): Promise<boolean> {
    try {
      const result = await this.db.run(
        'UPDATE accounts SET status = ? WHERE shopper_id = ?',
        [status, shopperId]
      );
      return result.changes > 0;
    } catch (error) {
      logger.error('Error updating account status:', error);
      throw error;
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
      logger.error('Error getting or creating account:', error);
      throw error;
    }
  }

  /**
   * Get all accounts (for admin purposes)
   */
  async getAllAccounts(): Promise<Account[]> {
    try {
      return await this.db.all<Account>('SELECT * FROM accounts ORDER BY created_at DESC');
    } catch (error) {
      logger.error('Error getting all accounts:', error);
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
      const accountWithPlan = await this.db.get<Account & { 
        plan_name?: string; 
        plan_site_limit?: number; 
        plan_price?: number; 
      }>(
        `SELECT a.*, p.name as plan_name, p.site_limit as plan_site_limit, 
               p.price as plan_price
        FROM accounts a 
        LEFT JOIN plans p ON a.plan_id = p.id 
        WHERE a.shopper_id = ?`,
        [shopperId]
      );
      return accountWithPlan || null;
    } catch (error) {
      logger.error('Error getting account with plan:', error);
      throw error;
    }
  }

  /**
   * Create a new plan (for admin purposes)
   */
  async createPlan(name: string, siteLimit: number, price: number): Promise<Plan> {
    try {
      const id = uuidv4();
      
      await this.db.run(
        `INSERT INTO plans (id, name, site_limit, price)
         VALUES (?, ?, ?, ?)`,
        [id, name, siteLimit, price]
      );

      const newPlan = await this.db.get<Plan>(
        'SELECT * FROM plans WHERE id = ?',
        [id]
      );

      if (!newPlan) {
        throw new Error('Failed to create plan');
      }

      logger.info(`✅ Created new plan: ${name} (${id})`);
      return newPlan;
    } catch (error) {
      logger.error('Error creating plan:', error);
      throw error;
    }
  }

  /**
   * Get all plans (for admin/frontend usage)
   */
  async getAllPlans(): Promise<Plan[]> {
    try {
      return await this.db.all<Plan>('SELECT * FROM plans ORDER BY price ASC');
    } catch (error) {
      logger.error('Error getting all plans:', error);
      throw error;
    }
  }
}
