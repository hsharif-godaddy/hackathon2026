import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
// @ts-expect-error - gd-auth-client is a CommonJS module without TypeScript definitions
import { getTokenFromCertificate } from 'gd-auth-client';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { TokenCache } from '../types/index.js';

class SSOClient {
  // Cache tokens per SSO host (production vs test)
  private tokenCaches: Map<string, TokenCache>;

  constructor() {
    this.tokenCaches = new Map();

    // Log initial configuration
    logger.info('[SSO] Client initialized', {
      defaultSsoHost: config.sso.host,
      certPath: config.getty.certs.certPath,
      keyPath: config.getty.certs.keyPath,
      tokenExpiry: config.sso.tokenExpiry
    });
  }

  async getToken(ssoHost?: string): Promise<string> {
    // Use provided host or default from config
    const host = ssoHost ?? config.sso.host;
    const now = new Date();

    // Get or create token cache for this host
    let tokenCache = this.tokenCaches.get(host);
    if (!tokenCache) {
      tokenCache = {
        token: null,
        expires: null,
        isRefreshing: false,
        refreshPromise: null
      };
      this.tokenCaches.set(host, tokenCache);
      logger.info('[SSO] Created new token cache', { ssoHost: host });
    }

    // Check if we have a valid cached token for this host
    if (tokenCache.token && tokenCache.expires && now < tokenCache.expires) {
      const remainingMs = tokenCache.expires.getTime() - now.getTime();
      const remainingMins = Math.round(remainingMs / 60000);

      logger.debug('[SSO] Using cached token', {
        ssoHost: host,
        expiresAt: tokenCache.expires.toISOString(),
        remainingMinutes: remainingMins,
        tokenPreview: tokenCache.token.substring(0, 20) + '...'
      });

      return tokenCache.token;
    }

    // Log why we need a new token
    if (!tokenCache.token) {
      logger.info('[SSO] No cached token available, requesting new token', { ssoHost: host });
    } else if (tokenCache.expires && now >= tokenCache.expires) {
      logger.info('[SSO] Cached token expired', {
        ssoHost: host,
        expiredAt: tokenCache.expires.toISOString(),
        expiredAgoMs: now.getTime() - tokenCache.expires.getTime()
      });
    }

    // If a refresh is already in progress for this host, wait for it
    if (tokenCache.isRefreshing && tokenCache.refreshPromise) {
      logger.debug('[SSO] Token refresh already in progress, waiting...', { ssoHost: host });
      return tokenCache.refreshPromise;
    }

    // Start token refresh for this host
    logger.info('[SSO] Starting token refresh', { ssoHost: host });
    tokenCache.isRefreshing = true;
    tokenCache.refreshPromise = this._refreshToken(host, tokenCache);

    try {
      const token = await tokenCache.refreshPromise;
      return token;
    } finally {
      tokenCache.isRefreshing = false;
      tokenCache.refreshPromise = null;
    }
  }

  private async _refreshToken(ssoHost: string, tokenCache: TokenCache): Promise<string> {
    const startTime = Date.now();
    const certPath = config.getty.certs.certPath;
    const keyPath = config.getty.certs.keyPath;

    logger.info('[SSO] Token refresh starting', {
      ssoHost,
      certPath,
      keyPath
    });

    // Check if certificate files exist
    const certExists = existsSync(certPath);
    const keyExists = existsSync(keyPath);

    logger.debug('[SSO] Certificate file check', {
      certPath,
      certExists,
      keyPath,
      keyExists
    });

    if (!certExists || !keyExists) {
      const error = `Getty client certificates not available: cert=${certExists}, key=${keyExists}`;
      logger.error('[SSO] Certificate files missing', {
        certPath,
        certExists,
        keyPath,
        keyExists
      });
      throw new Error(error);
    }

    try {
      // Get file stats for debugging
      const [certStat, keyStat] = await Promise.all([
        stat(certPath),
        stat(keyPath)
      ]);

      logger.debug('[SSO] Certificate file details', {
        certSize: certStat.size,
        certModified: certStat.mtime.toISOString(),
        keySize: keyStat.size,
        keyModified: keyStat.mtime.toISOString()
      });

      // Read certificate and key files
      logger.debug('[SSO] Reading certificate files...');
      const readStartTime = Date.now();

      const [cert, key] = await Promise.all([
        readFile(certPath, 'utf8'),
        readFile(keyPath, 'utf8')
      ]);

      logger.debug('[SSO] Certificate files read successfully', {
        certLength: cert.length,
        keyLength: key.length,
        certPreview: cert.substring(0, 50) + '...',
        readDurationMs: Date.now() - readStartTime
      });

      // Get token using gd-auth-client
      logger.info('[SSO] Calling getTokenFromCertificate', {
        ssoHost,
        certLength: cert.length,
        keyLength: key.length
      });

      const tokenStartTime = Date.now();
      const token = await getTokenFromCertificate(ssoHost, cert, key);
      const tokenDurationMs = Date.now() - tokenStartTime;

      logger.info('[SSO] getTokenFromCertificate returned successfully', {
        tokenLength: token?.length ?? 0,
        tokenPreview: token ? token.substring(0, 30) + '...' : 'null',
        durationMs: tokenDurationMs
      });

      if (!token) {
        throw new Error('getTokenFromCertificate returned empty token');
      }

      // Decode JWT to get actual expiry time
      let expires: Date;
      try {
        const tokenParts = token.split('.');
        if (tokenParts.length === 3 && tokenParts[1]) {
          const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString('utf8'));
          
          // Log token details for debugging
          logger.debug('[SSO] Token payload decoded', {
            tokenType: payload.typ,
            tokenAuth: payload.auth,
            tokenSubject: payload.sub,
            tokenIssuer: payload.iss,
            tokenExpiry: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'unknown'
          });
          
          if (payload.exp && typeof payload.exp === 'number') {
            // Use actual JWT expiry
            expires = new Date(payload.exp * 1000);
          } else {
            // Fallback to config if no expiry in token
            logger.warn('[SSO] JWT token missing exp claim, using config default');
            expires = new Date(Date.now() + (config.sso.tokenExpiry * 1000));
          }
        } else {
          // Invalid JWT format, use config default
          logger.warn('[SSO] Invalid JWT format, using config default expiry');
          expires = new Date(Date.now() + (config.sso.tokenExpiry * 1000));
        }
      } catch (decodeError) {
        // Failed to decode, use config default
        logger.warn('[SSO] Failed to decode JWT payload, using config default', {
          error: decodeError instanceof Error ? decodeError.message : String(decodeError)
        });
        expires = new Date(Date.now() + (config.sso.tokenExpiry * 1000));
      }

      // Cache token with actual expiry
      tokenCache.token = token;
      tokenCache.expires = expires;

      const totalDurationMs = Date.now() - startTime;
      const expirySeconds = Math.round((expires.getTime() - Date.now()) / 1000);

      logger.info('[SSO] Token refresh completed successfully', {
        ssoHost,
        tokenLength: token.length,
        tokenPreview: token.substring(0, 30) + '...',
        expiresAt: expires.toISOString(),
        expirySeconds,
        totalDurationMs
      });

      return token;
    } catch (error) {
      const totalDurationMs = Date.now() - startTime;

      logger.error('[SSO] Token refresh failed', {
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorStack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join('\n') : undefined,
        ssoHost,
        certPath,
        keyPath,
        totalDurationMs
      });

      throw error;
    }
  }

  clearCache(ssoHost?: string): void {
    if (ssoHost) {
      // Clear cache for specific host
      const tokenCache = this.tokenCaches.get(ssoHost);
      if (tokenCache) {
        const hadToken = !!tokenCache.token;
        const previousExpiry = tokenCache.expires;

        this.tokenCaches.delete(ssoHost);

        logger.info('[SSO] Token cache cleared', {
          ssoHost,
          hadToken,
          previousExpiry: previousExpiry?.toISOString() ?? null
        });
      }
    } else {
      // Clear all caches
      const hostCount = this.tokenCaches.size;
      this.tokenCaches.clear();

      logger.info('[SSO] All token caches cleared', {
        hostCount
      });
    }
  }
}

export default new SSOClient();
