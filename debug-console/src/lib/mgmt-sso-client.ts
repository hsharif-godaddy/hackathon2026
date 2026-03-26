// @ts-expect-error - gd-auth-client is a CommonJS module without TypeScript definitions
import { getTokenFromCertificate } from 'gd-auth-client';

interface TokenCache {
    token: string | null;
    expires: Date | null;
    isRefreshing: boolean;
    refreshPromise: Promise<string> | null;
}

function getSsoHost(): string {
    const ssoUrl = process.env.SSO_LOGIN_URL || 'https://sso.test-godaddy.com/login';
    return ssoUrl.includes('test') ? 'sso.test-godaddy.com' : 'sso.godaddy.com';
}

function getMgmtBaseUrl(): string {
    return process.env.MGMT_AIRO_BASE_URL || 'https://mgmt.nstk.net';
}

function getCertPaths(): { cert: string; key: string } {
    // These are the cert and key contents, injected to process from Katana secrets.
    return {
        cert: process.env.CONSOLE_CERT || '',
        key: process.env.CONSOLE_KEY || '',
    };
}

class MgmtSSOClient {
    private tokenCache: TokenCache = {
        token: null,
        expires: null,
        isRefreshing: false,
        refreshPromise: null
    };

    async getToken(): Promise<string> {
        const now = new Date();

        // Subtract 60s to refresh slightly before actual expiry (clock skew / network latency)
        const effectiveExpiry = this.tokenCache.expires
            ? new Date(this.tokenCache.expires.getTime() - 60_000)
            : null;

        if (this.tokenCache.token && effectiveExpiry && now < effectiveExpiry) {
            return this.tokenCache.token;
        }

        if (this.tokenCache.isRefreshing && this.tokenCache.refreshPromise) {
            return this.tokenCache.refreshPromise;
        }

        this.tokenCache.isRefreshing = true;
        this.tokenCache.refreshPromise = this._refreshToken();

        try {
            return await this.tokenCache.refreshPromise;
        } finally {
            this.tokenCache.isRefreshing = false;
            this.tokenCache.refreshPromise = null;
        }
    }

    private async _refreshToken(): Promise<string> {
        const ssoHost = getSsoHost();
        const { cert, key } = getCertPaths();

        if (!cert || !key) {
            throw new Error(
                `Mgmt client certificates not found: hasCert=${!!cert}, hasKey=${!!key}. ` +
                `Set CONSOLE_CERT and CONSOLE_KEY env vars.`
            );
        }

        try {
            const token = await getTokenFromCertificate(ssoHost, cert, key);

            if (!token) {
                throw new Error('getTokenFromCertificate returned empty token');
            }

            // Decode JWT expiry, fall back to 1 hour
            let expires: Date;
            try {
                const parts = token.split('.');
                if (parts.length === 3 && parts[1]) {
                    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
                    expires = typeof payload.exp === 'number'
                        ? new Date(payload.exp * 1000)
                        : new Date(Date.now() + 3600 * 1000);
                } else {
                    expires = new Date(Date.now() + 3600 * 1000);
                }
            } catch {
                expires = new Date(Date.now() + 3600 * 1000);
            }

            this.tokenCache.token = token;
            this.tokenCache.expires = expires;

            return token;
        } catch (error) {
            console.error('[mgmt-sso] Token refresh failed', {
                error: error instanceof Error ? error.message : String(error),
                ssoHost,
                hasCert: !!cert,
                hasKey: !!key,
            });
            throw error;
        }
    }

    clearCache(): void {
        this.tokenCache = {
            token: null,
            expires: null,
            isRefreshing: false,
            refreshPromise: null
        };
    }

    /**
     * Make an authenticated request to the mgmt airo control plane.
     * Token is automatically fetched and cached.
     */
    async fetch(path: string, init: RequestInit & { timeoutMs?: number } = {}, retried = false): Promise<Response> {
        const response = await this._fetch(path, init);

        if (response.status === 401 && !retried) {
            this.clearCache();
            return this.fetch(path, init, true);
        }

        return response;
    }

    private async _fetch(path: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
        const token = await this.getToken();
        const { timeoutMs, ...fetchInit } = init;

        return fetch(`${getMgmtBaseUrl()}${path}`, {
            ...fetchInit,
            headers: {
                'Content-Type': 'application/json',
                ...fetchInit.headers,
                Authorization: `sso-jwt ${token}`
            },
            signal: AbortSignal.timeout(timeoutMs ?? 10000),
            cache: 'no-store' as RequestCache,
        });
    }
}

const mgmtSSOClient = new MgmtSSOClient();
export default mgmtSSOClient;
