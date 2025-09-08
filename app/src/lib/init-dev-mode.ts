/**
 * Development mode initialization
 * Sets up test data and configurations needed for local development
 */

import { initializeTestUser } from './database/seed-test-user';
import { isFeatureEnabled } from './features';

let initialized = false;

/**
 * Initialize development mode features
 * Should be called once during app startup
 */
export async function initDevMode(): Promise<void> {
  // Prevent multiple initializations
  if (initialized) {
    return;
  }

  try {
    // Only initialize in development
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    console.log('🔧 Initializing development mode...');

    // Initialize test user if mock login is enabled
    if (isFeatureEnabled.mockLogin()) {
      await initializeTestUser();
    }

    initialized = true;
    console.log('✅ Development mode initialized');
  } catch (error) {
    console.error('❌ Failed to initialize development mode:', error);
    // Don't throw - let the app continue even if dev setup fails
  }
}