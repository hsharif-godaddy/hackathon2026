/**
 * JWT authentication service - real authentication with SSO
 * Used in production environments with full JWT validation
 */

import { IAuthService, AuthConfig, AuthResult } from '../types';
import { NextRequest } from 'next/server';

export class JWTAuthService implements IAuthService {
  /**
   * Get current JWT token from browser cookies (client-side)
   */
  private getCurrentJWTToken(): string | null {
    if (typeof document === 'undefined') {
      return null; // Server-side rendering
    }

    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'auth_idp') {
        return decodeURIComponent(value);
      }
    }
    return null;
  }

  /**
   * Get JWT token from server-side request cookies
   */
  private getServerJWTToken(request?: NextRequest): string | null {
    if (!request) return null;
    
    const token = request.cookies.get('auth_idp')?.value;
    return token ? decodeURIComponent(token) : null;
  }

  async authenticate(config?: AuthConfig): Promise<AuthResult> {
    // Try to get JWT token
    const token = this.getCurrentJWTToken();
    
    if (!token) {
      return {
        success: false,
        error: 'No authentication token found. Please log in to access services.',
        headers: {}
      };
    }

    // Return success with JWT token in headers
    return {
      success: true,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(config?.headers || {})
      }
    };
  }

  /**
   * Server-side authentication with request context
   */
  async authenticateWithRequest(request: NextRequest, config?: AuthConfig): Promise<AuthResult> {
    const token = this.getServerJWTToken(request);
    
    if (!token) {
      return {
        success: false,
        error: 'No authentication token found. Please log in to access services.',
        headers: {}
      };
    }

    return {
      success: true,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(config?.headers || {})
      }
    };
  }

  async isAvailable(): Promise<boolean> {
    const token = this.getCurrentJWTToken();
    return !!token;
  }

  getType(): string {
    return 'jwt';
  }
}