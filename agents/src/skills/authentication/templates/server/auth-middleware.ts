/**
 * BetterAuth Express Middleware
 *
 * Single catch-all handler for ALL /api/auth/* requests.
 * BetterAuth routes internally (CSRF, sessions, sign-in, sign-up,
 * OAuth callbacks, token refresh, etc.)
 *
 * Called by the dynamic route files under src/server/api/auth/[action]/.
 */
import type { Request, Response } from 'express';
import { getAuth } from '@/lib/auth/auth';
import { toWebRequest, sendWebResponse } from '@/lib/auth/express-adapter';

export async function authHandler(req: Request, res: Response) {
  try {
    const auth = getAuth();
    const webResponse = await auth.handler(toWebRequest(req));
    await sendWebResponse(webResponse, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (message.includes('BETTER_AUTH_SECRET')) {
      console.error(JSON.stringify({ event: 'auth.error', reason: 'missing_secret' }));
      res.status(503).json({
        error: 'Authentication not configured. Set BETTER_AUTH_SECRET via requestSecrets().',
      });
      return;
    }

    if (message.includes('Database not configured') || message.includes('SQLITE') || message.includes('ECONNREFUSED')) {
      console.error(JSON.stringify({ event: 'auth.error', reason: 'database_unavailable' }));
      res.status(503).json({
        error: 'Database not available. Ensure the database skill is installed and configured.',
      });
      return;
    }

    if (message.includes("doesn't exist") || message.includes('no such table') || message.includes('relation') || message.includes('ER_NO_SUCH_TABLE')) {
      console.error(JSON.stringify({ event: 'auth.error', reason: 'missing_tables', error: message }));
      res.status(503).json({
        error: 'Auth database tables not found. Run migrations: npm run db:generate && npm run db:migrate',
      });
      return;
    }

    console.error(JSON.stringify({ event: 'auth.middleware.error', path: req.path, error: message }));
    res.status(500).json({ error: 'Authentication request failed' });
  }
}
