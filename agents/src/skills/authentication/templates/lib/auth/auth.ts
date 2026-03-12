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
import { getSecret } from '#airo/secrets';

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'mysql' }),
  secret: getSecret('BETTER_AUTH_SECRET') as string,

  // CORS: Only trust origins matching the server's hostname
  // Returns the origin if valid, empty array if not
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

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session['user'];
