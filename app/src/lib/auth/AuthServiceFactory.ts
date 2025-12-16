/**
 * Auth service factory - creates the appropriate auth service based on configuration
 */

import { JWTAuthService } from './implementations/JWTAuthService';
import { MockAuthService } from './implementations/MockAuthService';
import { NoAuthService } from './implementations/NoAuthService';
import { IAuthService } from './types';
import { auth,AuthType } from '../features';

/**
 * Factory class to create auth services
 */
export class AuthServiceFactory {
  private static instance: IAuthService | null = null;

  /**
   * Get the appropriate auth service based on current configuration
   */
  static getInstance(): IAuthService {
    if (!AuthServiceFactory.instance) {
      AuthServiceFactory.instance = AuthServiceFactory.createAuthService();
    }
    return AuthServiceFactory.instance;
  }

  /**
   * Force reset the singleton (useful for testing)
   */
  static reset(): void {
    AuthServiceFactory.instance = null;
  }

  /**
   * Create auth service based on current auth type
   */
  private static createAuthService(): IAuthService {
    // Get auth configuration
    const authType = auth.getType();

    switch (authType) {
      case AuthType.NONE:
        return new NoAuthService();
      
      case AuthType.MOCK:
        return new MockAuthService();
      
      case AuthType.JWT:
        return new JWTAuthService();
      
      default:
        // Fallback to JWT for security
        return new JWTAuthService();
    }
  }

  /**
   * Get auth service type for debugging
   */
  static getCurrentAuthType(): string {
    return AuthServiceFactory.getInstance().getType();
  }
}

/**
 * Convenience function to get the auth service
 */
export function getAuthService(): IAuthService {
  return AuthServiceFactory.getInstance();
}