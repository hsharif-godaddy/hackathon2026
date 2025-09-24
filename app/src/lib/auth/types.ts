/**
 * Authentication service interfaces and types
 */

import { NextRequest } from 'next/server';

export interface AuthConfig {
  /** Authentication is required for this request */
  required?: boolean;
  /** Custom headers to include */
  headers?: Record<string, string>;
}

export interface AuthResult {
  /** Whether authentication was successful */
  success: boolean;
  /** Error message if authentication failed */
  error?: string;
  /** Headers to include in the request */
  headers: Record<string, string>;
}

/**
 * Authentication service interface
 * All auth implementations must conform to this interface
 */
export interface IAuthService {
  /** Get authentication headers for a request */
  authenticate(config?: AuthConfig): Promise<AuthResult>;
  
  /** Server-side authentication with request context (optional) */
  authenticateWithRequest?(request: NextRequest, config?: AuthConfig): Promise<AuthResult>;
  
  /** Check if authentication is currently available/valid */
  isAvailable(): Promise<boolean>;
  
  /** Get the auth service type for debugging */
  getType(): string;
}