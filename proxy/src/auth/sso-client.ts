import https from 'https';
import fs from 'fs';
import { config } from '../config';
import logger from '../utils/logger';
import { TokenCache, SSOResponse } from '../types';

class SSOClient {
  private tokenCache: TokenCache;

  constructor() {
    this.tokenCache = {
      token: null,
      expires: null,
      isRefreshing: false,
      refreshPromise: null
    };
  }

  async getToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.tokenCache.token && this.tokenCache.expires && new Date() < this.tokenCache.expires) {
      return this.tokenCache.token;
    }

    // If a refresh is already in progress, wait for it
    if (this.tokenCache.isRefreshing && this.tokenCache.refreshPromise) {
      return this.tokenCache.refreshPromise;
    }

    // Start token refresh
    this.tokenCache.isRefreshing = true;
    this.tokenCache.refreshPromise = this._refreshToken();

    try {
      const token = await this.tokenCache.refreshPromise;
      return token;
    } finally {
      this.tokenCache.isRefreshing = false;
      this.tokenCache.refreshPromise = null;
    }
  }

  private async _refreshToken(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!fs.existsSync(config.getty.certs.certPath) || !fs.existsSync(config.getty.certs.keyPath)) {
        return reject(new Error('Getty client certificates not available for SSO authentication'));
      }

      const url = new URL(config.sso.endpoint);
      const postData = `realm=${encodeURIComponent(config.sso.realm)}`;

      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        cert: fs.readFileSync(config.getty.certs.certPath),
        key: fs.readFileSync(config.getty.certs.keyPath),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        },
        timeout: config.sso.timeout
      };

      // Refreshing SSO token

      const request = https.request(options, (response) => {
        let data = '';

        response.on('data', (chunk) => {
          data += chunk;
        });

        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            try {
              const responseData: SSOResponse = JSON.parse(data);
              const token = responseData.data ?? responseData.access_token ?? responseData.token ?? data.trim();
              const expiresIn = responseData.expires_in ?? config.sso.tokenExpiry;
              const expires = new Date(Date.now() + (expiresIn * 1000));

              this.tokenCache.token = token;
              this.tokenCache.expires = expires;
              
              // SSO token refreshed successfully
              resolve(token);

            } catch {
              const token = data.trim();
              if (token) {
                const expires = new Date(Date.now() + (50 * 60 * 1000));
                this.tokenCache.token = token;
                this.tokenCache.expires = expires;
                
                // SSO token refreshed (non-JSON response)
                resolve(token);
              } else {
                logger.error('Empty response from SSO endpoint');
                reject(new Error('Empty response from SSO endpoint'));
              }
            }
          } else {
            logger.error('SSO authentication failed', { statusCode: response.statusCode, response: data });
            reject(new Error(`SSO authentication failed with status ${response.statusCode ?? 'unknown'}`));
          }
        });
      });

      request.on('error', (error) => {
        logger.error('SSO request failed', { error: error.message });
        reject(error);
      });

      request.on('timeout', () => {
        logger.error('SSO request timed out');
        request.destroy();
        reject(new Error('SSO request timed out'));
      });

      request.write(postData);
      request.end();
    });
  }

  clearCache(): void {
    this.tokenCache = {
      token: null,
      expires: null,
      isRefreshing: false,
      refreshPromise: null
    };
    // SSO token cache cleared
  }
}

export default new SSOClient();
