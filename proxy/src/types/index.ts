import { Request, Response } from 'express';

// Configuration types
export interface ServerConfig {
  port: number;
  host: string;
  ssl: {
    keyPath: string;
    certPath: string;
  };
}

export interface GettyConfig {
  upstream: string;
  appKey: string;
  userAgent: string;
  certs: {
    certPath: string;
    keyPath: string;
  };
}

export interface WebScraperConfig {
  upstream: string;
  appKey: string;
  userAgent: string;
}

export interface SSOConfig {
  endpoint: string;
  realm: string;
  timeout: number;
  tokenExpiry: number;
}

export interface AuthConfig {
  validTokens: string[];
}

export interface LoggingConfig {
  level: LogLevel;
  format: 'json' | 'text';
}

export interface AppConfig {
  server: ServerConfig;
  getty: GettyConfig;
  webScraper: WebScraperConfig;
  sso: SSOConfig;
  auth: AuthConfig;
  logging: LoggingConfig;
}

// Logging types
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LogMeta {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  [key: string]: unknown;
}

// Authentication types
export interface TokenCache {
  token: string | null;
  expires: Date | null;
  isRefreshing: boolean;
  refreshPromise: Promise<string> | null;
}

export interface SSOResponse {
  data?: string;
  access_token?: string;
  token?: string;
  expires_in?: number;
}

// Request types - ReqId can be string, number, or object depending on pino-http config
export interface AuthenticatedRequest extends Request {
  id: string | number | object;
  userToken?: string;
  startTime?: number;
}

// Getty API types
export interface GettySearchParams {
  phrase?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}

export interface GettyAPIResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  data: string;
  duration?: number;
}

export interface WebScraperParams {
  url: string;
  [key: string]: unknown;
}

export interface WebScraperAPIResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  data: string;
  duration?: number;
}

// Health check types
export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  version: string;
}

// Error types
export interface APIError {
  message: string;
  type: string;
  requestId?: string;
  statusCode?: number;
  response?: string;
}

export interface ErrorResponse {
  error: APIError;
}

// Express middleware types
export type Middleware = (req: Request, res: Response, next: NextFunction) => void;
export type AsyncMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => Promise<void>;

import { NextFunction } from 'express';

// HTTP Client types
export interface HTTPClientOptions {
  hostname: string;
  port?: number;
  path: string;
  method: string;
  headers: Record<string, string>;
  cert?: Buffer;
  key?: Buffer;
  timeout?: number;
}

// Environment variables interface
export interface EnvironmentVariables {
  PORT?: string;
  LOG_LEVEL?: LogLevel;
  LOG_FORMAT?: 'json' | 'text';
  GETTY_IMAGES_UPSTREAM?: string;
  GETTY_APP_KEY?: string;
  WEB_SCRAPER_UPSTREAM?: string;
  WEB_SCRAPER_APP_KEY?: string;
  SSO_ENDPOINT?: string;
  SSO_REALM?: string;
  SSO_TIMEOUT?: string;
  GETTY_CERTS_JSON?: string;
  NODE_ENV?: 'development' | 'production' | 'test';
  USER_AGENT?: string;
  TOKEN_EXPIRY?: string;
  VALID_TOKENS?: string;
}

// Certificate types
export interface CertificateFiles {
  [key: string]: string;
}

