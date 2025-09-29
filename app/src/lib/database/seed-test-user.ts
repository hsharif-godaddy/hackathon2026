import { logger } from '../request-context';
/**
 * Database seeding utility for test user
 * Creates a test account that works with the existing auth system
 */

import { getAccountService } from './account-service';

// Test user for development environment
const TEST_USER = {
  id: 'dev-user-123',
  email: 'developer@example.com',
  name: 'Dev User',
  plan: 'Free'
};

/**
 * Ensure test user account exists in the database
 * This allows the mock auth system to work with existing APIs without spreading mock code everywhere
 */
export async function ensureTestUserExists(): Promise<void> {
  try {
    const accountService = getAccountService(); // Use singleton instance
    const testShopperId = TEST_USER.id;
    const testCustomerId = TEST_USER.id; // Use same ID for simplicity
    
    // Check if account already exists
    let account = await accountService.findByShopperId(testShopperId);
    
    if (!account) {
      logger.info('🌱 Seeding test user account...');
      try {
        account = await accountService.createAccount(testShopperId, testCustomerId);
        logger.info(`✅ Test user account created: ${account.id} (shopper: ${testShopperId})`);
      } catch (error: any) {
        // Account might already exist due to race condition
        if (error.message.includes('UNIQUE constraint failed')) {
          account = await accountService.findByShopperId(testCustomerId);
          if (account) {
            logger.info(`✅ Test user account found: ${account.id}`);
          }
        } else {
          logger.error('❌ Failed to create test user account:', error);
          throw error;
        }
      }
    } else {
      logger.info(`✅ Test user account exists: ${account.id}`);
    }
  } catch (error) {
    logger.error('❌ Error ensuring test user exists:', error);
    throw error;
  }
}

/**
 * Call this during app initialization in development mode
 */
export async function initializeTestUser(): Promise<void> {
  // Only seed in development when mock login is needed
  if (process.env.NODE_ENV === 'development') {
    await ensureTestUserExists();
  }
}