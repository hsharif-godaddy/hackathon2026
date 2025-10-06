/**
 * JWT authentication service - real authentication with SSO
 * Used in production environments with full JWT validation
 */

import { logger } from '@/lib/request-context';
import { IAuthService, AuthConfig, AuthResult } from '../types';
import { NextRequest } from 'next/server';

export class JWTAuthService implements IAuthService {
  /**
   * Get current JWT token from HttpOnly cookie via API route (client-side)
   * HttpOnly cookies cannot be read directly from document.cookie, 
   * so we use an API route to read them server-side
   */
  private async getCurrentJWTToken(): Promise<string | null> {
    if (typeof window === 'undefined') {
      logger.info('jwt-auth.getCurrentJWTToken', { message: 'window is undefined, returning null token'});
      return null; // Server-side rendering
    }

    try {
      const response = await fetch('/api/auth/token', {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        logger.error('jwt-auth.getCurrentJWTToken', { 
          message: 'Failed to fetch token from API', 
          status: response.status 
        });
        return null;
      }

      const data = await response.json();
      const token = data.token;

      if (token) {
        logger.info('jwt-auth.getCurrentJWTToken', { message: 'Successfully fetched token from API' });
      } else {
        logger.info('jwt-auth.getCurrentJWTToken', { message: 'No token found in API response' });
      }

      return token;
    } catch (error) {
      logger.error('jwt-auth.getCurrentJWTToken', { 
        message: 'Error fetching token from API', 
        error: error instanceof Error ? error.message : String(error) 
      });
      return null;
    }
  }

  /**
   * Get JWT token from server-side request cookies
   */
  private getServerJWTToken(request?: NextRequest): string | null {
    if (!request) {
      logger.info('jwt-auth.getServerJWTToken', { message: 'request is null'}); 
      return null;
    }

    const token = request.cookies.get('auth_idp')?.value;
    logger.info('jwt-auth.getServerJWTToken', { 
      message: 'Extracted token from request cookies', 
      hasToken: !!token 
    });

    return token ? decodeURIComponent(token) : null;
  }

  async authenticate(config?: AuthConfig): Promise<AuthResult> {
    const token = await this.getCurrentJWTToken();
    
    logger.info('jwt-auth.authenticate', { message: 'Authenticating with JWT', hasToken: !!token });

    if (!token) {
      logger.info('jwt-auth.authenticate', { message: 'No authentication token found, returning error' });
      return {
        success: false,
        error: 'No authentication token found. Please log in to access services.',
        headers: {}
      };
    }

    logger.info('jwt-auth.authenticate', { message: 'Authentication successful' });
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
      logger.info('jwt-auth.authenticateWithRequest', { message: 'No authentication token found, returning error' });
      return {
        success: false,
        error: 'No authentication token found. Please log in to access services.',
        headers: {}
      };
    }

    logger.info('jwt-auth.authenticateWithRequest', { message: 'Authentication successful' });
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
    const token = await this.getCurrentJWTToken();
    return !!token;
  }

  getType(): string {
    return 'jwt';
  }
}
