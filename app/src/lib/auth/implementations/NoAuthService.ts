/**
 * No authentication service - allows all requests without authentication
 * Used in local development where no auth is required
 */

import { AuthConfig, AuthResult,IAuthService } from '../types';

export class NoAuthService implements IAuthService {
  async authenticate(config?: AuthConfig): Promise<AuthResult> {
    // No auth required - just return success with basic headers
    return {
      success: true,
      headers: {
        'Content-Type': 'application/json',
        ...(config?.headers || {})
      }
    };
  }

  async isAvailable(): Promise<boolean> {
    // Always available since no auth is required
    return true;
  }

  getType(): string {
    return 'none';
  }
}