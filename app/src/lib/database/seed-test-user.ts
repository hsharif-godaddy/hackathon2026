/**
 * Database seeding utility for test user
 * Creates a test account that works with the existing auth system
 */

import { AccountService } from './account-service';
import { MOCK_USER } from '@/lib/mock-auth';

const accountService = new AccountService();

/**
 * Ensure test user account exists in the database
 * This allows the mock auth system to work with existing APIs without spreading mock code everywhere
 */
export async function ensureTestUserExists(): Promise<void> {
  try {
    const testShopperId = MOCK_USER.id;
    const testCustomerId = MOCK_USER.id; // Use same ID for simplicity
    
    // Check if account already exists
    let account = await accountService.findByShopperId(testShopperId);
    
    if (!account) {
      console.log('🌱 Seeding test user account...');
      try {
        account = await accountService.createAccount(testShopperId, testCustomerId);
        console.log(`✅ Test user account created: ${account.id} (shopper: ${testShopperId})`);
      } catch (error: any) {
        // Account might already exist due to race condition
        if (error.message.includes('UNIQUE constraint failed')) {
          account = await accountService.findByCustomerId(testCustomerId);
          if (account) {
            console.log(`✅ Test user account found: ${account.id}`);
          }
        } else {
          console.error('❌ Failed to create test user account:', error);
          throw error;
        }
      }
    } else {
      console.log(`✅ Test user account exists: ${account.id}`);
    }
  } catch (error) {
    console.error('❌ Error ensuring test user exists:', error);
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