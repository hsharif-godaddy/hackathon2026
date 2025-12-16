/**
 * Development mode initialization
 * Sets up test data and configurations needed for local development
 */
import { initializeTestUser } from './database/seed-test-user';
import { logger } from './request-context';

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

    logger.info('🔧 Initializing development mode...');

    // Initialize test user for development
    await initializeTestUser();

    initialized = true;
    logger.info('✅ Development mode initialized');
  } catch (error) {
    logger.error('❌ Failed to initialize development mode:', error);
    // Don't throw - let the app continue even if dev setup fails
  }
}
