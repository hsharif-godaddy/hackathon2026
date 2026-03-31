/**
 * BetterAuth Server Configuration
 *
 * Supports both Email/Password and OAuth authentication.
 * Enable/disable methods by uncommenting the relevant sections.
 *
 * Secrets (via getSecret from #airo/secrets):
 * - BETTER_AUTH_SECRET: Session encryption key (auto-generated during install)
 * - OAuth credentials (GOOGLE_CLIENT_ID, etc.) for social login
 *
 * CORS/Trusted Origins:
 * - Only trusts origins matching the server's hostname
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { db } from '@/server/db/client';
import { user, session, account, verification } from '@/server/db/schema';
import { getSecret } from '#airo/secrets';

// Lazy singleton — betterAuth() must NOT run at module init time.
//
// The BETTER_AUTH_SECRET is loaded from the alloc config at runtime, so the
// auth instance must be constructed after the secrets are available (i.e. on
// the first HTTP request, not at import time).
//
// Pattern mirrors how db/client.ts defers the actual MySQL connection — the
// pool object is safe to create at init, but anything that reads schema state
// or secrets must be deferred to request time.
let _auth: ReturnType<typeof betterAuth> | null = null;

export function getAuth(): ReturnType<typeof betterAuth> {
  if (_auth) return _auth;

  const authSecret = getSecret('BETTER_AUTH_SECRET');
  if (!authSecret) throw new Error('BETTER_AUTH_SECRET is not set — run requestSecrets() first');

  _auth = betterAuth({
    // Schema passed explicitly — avoids BetterAuth's runtime schema inference.
    database: drizzleAdapter(db, {
      provider: 'mysql',
      schema: { user, session, account, verification },
    }),

    secret: authSecret,

    // CORS: Trusts .airoapp.ai subdomains and localhost by default.
    // If your app has a custom domain, add it here or set BETTER_AUTH_TRUSTED_ORIGINS.
    trustedOrigins: (request) => {
      if (!request) return [];

      const origin = request.headers.get('origin');
      if (!origin) return [];

      try {
        const originUrl = new URL(origin);
        const hostname = originUrl.hostname;

        // Trust all airoapp.ai subdomains
        if (hostname.endsWith('.airoapp.ai') || hostname.endsWith('.test-airoapp.ai')) {
          return [origin];
        }

        // Trust localhost for development
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
          return [origin];
        }

        return [];
      } catch {
        return [];
      }
    },

    // In preview mode the site runs in an iframe embedded by the builder on a different
    // origin, so cookies need SameSite=None + Secure + Partitioned (CHIPS) for cross-site
    // access. In publish mode (standalone) we use the safer SameSite=Lax default.
    ...(process.env.AIRO_PREVIEW === 'true' && {
      advanced: {
        defaultCookieAttributes: {
          sameSite: 'none' as const,
          secure: true,
          partitioned: true,
        },
      },
    }),

    // emailAndPassword: { enabled: true },

    // socialProviders: {
    //   google: {
    //     clientId: getSecret('GOOGLE_CLIENT_ID') as string,
    //     clientSecret: getSecret('GOOGLE_CLIENT_SECRET') as string,
    //   },
    //   github: {
    //     clientId: getSecret('GITHUB_CLIENT_ID') as string,
    //     clientSecret: getSecret('GITHUB_CLIENT_SECRET') as string,
    //   },
    // },
  });

  return _auth;
}

export type Session = ReturnType<typeof getAuth>['$Infer']['Session'];
export type User = ReturnType<typeof getAuth>['$Infer']['Session']['user'];
