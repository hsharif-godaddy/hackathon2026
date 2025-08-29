// Simple auth client to validate JWT tokens with the backend API

interface JWTPayload {
  [key: string]: unknown;
}

interface AuthValidationResult {
  valid: boolean;
  payload?: JWTPayload;
  reason?: string;
}

export class AuthClient {
  private apiUrl: string;

  constructor(apiUrl: string = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:3000') {
    this.apiUrl = apiUrl;
  }

  async validateToken(token: string): Promise<AuthValidationResult> {
    try {
      const response = await fetch(`${this.apiUrl}/api/auth/validate`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const result = await response.json();
      return result;
    } catch (error) {
      return {
        valid: false,
        reason: `API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async validateCurrentUser(): Promise<AuthValidationResult> {
    try {
      // Get token from cookie (set by gasket)
      const token = this.getTokenFromCookie();
      if (!token) {
        return { valid: false, reason: 'No token found in cookies' };
      }

      return await this.validateToken(token);
    } catch (error) {
      return {
        valid: false,
        reason: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  private getTokenFromCookie(): string | null {
    if (typeof document === 'undefined') return null;
    
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'auth_idp') {
        return decodeURIComponent(value);
      }
    }
    return null;
  }
}
