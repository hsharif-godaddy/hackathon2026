/**
 * JWT Service
 * Creates and manages JWT tokens using private keys from Secrets Manager
 * 
 * @note This file is server-only and uses Node.js crypto module
 */

import { createSign } from 'node:crypto';

import { GetSecretValueCommand,SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { getJWTConfig, getJWTConstants, JWTClaims } from './jwt-config';
import { logger } from './request-context';

export interface CreateTokenOptions {
  siteId: string;
  canDownload: boolean;
  canPublish: boolean;
}

export interface TokenResult {
  token: string;
  expires: Date;
}

interface KeyMetadata {
  keyId: string;
  privateKey: string;
  publicKey: string;
  status: 'active' | 'rotating';
  createdAt: string;
  expiresAt: string;
}

interface JWTSecretValue {
  keys: KeyMetadata[];
  lastRotation: string;
  nextRotation: string;
}

/**
 * JWT Service - handles token creation using private keys
 */
export class JWTService {
  private config = getJWTConfig();
  private constants = getJWTConstants();
  private secretsClient: SecretsManagerClient;
  private tokenCache = new Map<string, { token: string; expires: Date }>();
  private keyCache: { keys: KeyMetadata[]; cachedAt: Date } | null = null;
  private readonly keyCacheMaxAge = 5 * 60 * 1000;
  private fetchKeysPromise: Promise<KeyMetadata[]> | null = null;

  constructor() {
    this.secretsClient = new SecretsManagerClient({ region: this.config.awsRegion });
  }

  /**
   * Fetch all keys from Secrets Manager with caching and request deduplication
   */
  private async fetchKeys(): Promise<KeyMetadata[]> {
    // Return cached keys if still valid
    if (this.keyCache && (Date.now() - this.keyCache.cachedAt.getTime()) < this.keyCacheMaxAge) {
      return this.keyCache.keys;
    }

    // Deduplicate concurrent requests - if fetch is in progress, wait for it
    if (this.fetchKeysPromise) {
      return this.fetchKeysPromise;
    }

    // Start new fetch
    this.fetchKeysPromise = this.fetchKeysFromAWS();

    try {
      const keys = await this.fetchKeysPromise;
      return keys;
    } finally {
      this.fetchKeysPromise = null;
    }
  }

  /**
   * Internal method to fetch keys from AWS Secrets Manager
   */
  private async fetchKeysFromAWS(): Promise<KeyMetadata[]> {
    try {
      const command = new GetSecretValueCommand({
        SecretId: this.config.secretName
      });

      const response = await this.secretsClient.send(command);

      if (!response.SecretString) {
        throw new Error('No secret value found');
      }

      const secretValue: JWTSecretValue = JSON.parse(response.SecretString);

      // Update cache
      this.keyCache = {
        keys: secretValue.keys,
        cachedAt: new Date()
      };

      return secretValue.keys;

    } catch (error) {
      logger.error('jwt.keys.fetch.error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        secretName: this.config.secretName
      });
      throw new Error(`Failed to fetch keys: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get current active signing key from Secrets Manager
   */
  private async getActiveKey(): Promise<KeyMetadata> {
    const keys = await this.fetchKeys();

    const activeKey = keys.find(key => key.status === 'active');

    if (!activeKey) {
      throw new Error('No active signing key found');
    }

    logger.info('jwt.key.retrieved', {
      keyId: activeKey.keyId,
      status: activeKey.status
    });

    return activeKey;
  }

  /**
   * Create JWT header and payload
   * 
   * @param options - Token creation options
   * @param keyId - Key ID for JWT header
   * @param expiresInSeconds - Token expiration time in seconds (default: 12 hours)
   * @returns JWT header and payload as base64url strings
   */
  private createTokenPayload(options: CreateTokenOptions, keyId: string, expiresInSeconds?: number): { header: string; payload: string } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (expiresInSeconds || (12 * 60 * 60));

    const header = {
      typ: 'JWT',
      alg: this.constants.algorithm,
      kid: keyId
    };

    const claims: JWTClaims = {
      iss: this.constants.issuer,
      aud: this.constants.audience,
      exp,
      iat: now,
      siteId: options.siteId,
      canDownload: options.canDownload,
      canPublish: options.canPublish
    };

    const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadBase64 = Buffer.from(JSON.stringify(claims)).toString('base64url');

    return {
      header: headerBase64,
      payload: payloadBase64
    };
  }

  /**
   * Create JWT token using Node.js crypto for signing
   * 
   * @param options - Token creation options
   * @param expiresInSeconds - Token expiration time in seconds (default: 12 hours)
   * @returns Token and expiration date
   */
  async createToken(options: CreateTokenOptions, expiresInSeconds?: number): Promise<TokenResult> {
    try {
      const activeKey = await this.getActiveKey();
      
      const { header, payload } = this.createTokenPayload(options, activeKey.keyId, expiresInSeconds);
      
      const message = `${header}.${payload}`;
      
      const sign = createSign('RSA-SHA256');
      sign.update(message);
      sign.end();
      
      const signature = sign.sign(activeKey.privateKey, 'base64url');
      
      const token = `${message}.${signature}`;
      
      const exp = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')).exp;
      const expires = new Date(exp * 1000);
      
      logger.info('jwt.token.created', {
        siteId: options.siteId,
        keyId: activeKey.keyId,
        expiresAt: expires.toISOString()
      });

      return { token, expires };
      
    } catch (error) {
      logger.error('jwt.token.create.error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        siteId: options.siteId
      });
      
      throw new Error(`Failed to create JWT token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate cache key from token options
   * Includes permissions to avoid stale cache when permissions change
   */
  private getCacheKey(options: CreateTokenOptions): string {
    return `${options.siteId}:${options.canDownload}:${options.canPublish}`;
  }

  /**
   * Get cached token or create new one
   */
  async getToken(options: CreateTokenOptions): Promise<TokenResult> {
    const cacheKey = this.getCacheKey(options);
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expires > new Date(Date.now() + 60000)) {
      return cached;
    }

    const result = await this.createToken(options);
    this.tokenCache.set(cacheKey, result);

    return result;
  }

  /**
   * Refresh token
   */
  async refreshToken(options: CreateTokenOptions): Promise<TokenResult> {
    const result = await this.createToken(options);
    const cacheKey = this.getCacheKey(options);
    this.tokenCache.set(cacheKey, result);
    return result;
  }

  /**
   * Get all public keys for JWKS endpoint
   */
  async getPublicKeys(): Promise<KeyMetadata[]> {
    return this.fetchKeys();
  }
}

let jwtServiceInstance: JWTService | null = null;

export function getJWTService(): JWTService {
  if (!jwtServiceInstance) {
    jwtServiceInstance = new JWTService();
  }
  return jwtServiceInstance;
}
