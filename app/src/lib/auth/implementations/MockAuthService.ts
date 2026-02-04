/**
 * Mock authentication service - simulates authentication for testing
 * Provides fake tokens and credentials for development/testing
 */

import { AuthConfig, AuthResult, IAuthService } from '../types';

export class MockAuthService implements IAuthService {
  private mockToken = 'mock-jwt-token-dev-12345';

  async authenticate(config?: AuthConfig): Promise<AuthResult> {
    // Simulate successful authentication with mock token
    return {
      success: true,
      headers: {
        'Authorization': `Bearer ${this.mockToken}`,
        'Content-Type': 'application/json',
        ...(config?.headers || {})
      }
    };
  }

  async isAvailable(): Promise<boolean> {
    // Always available in mock mode
    return true;
  }

  getType(): string {
    return 'mock';
  }
}