/**
 * Share token purpose gating
 *
 * Validates the cert2s/archive_snapshot extension to POST /apps/:id/share:
 *   - default purpose (omitted → 'user') preserves the long-standing 1h–7d
 *     TTL window and existing UI behavior.
 *   - 'archive_snapshot' is allowed only when the JWT's authType === 'cert2s';
 *     basic / e2s / s2s callers are 403'd.
 *   - 'archive_snapshot' has its own 60s–15min TTL window and lives in its
 *     own "one active" slot per app — coexists with a 'user' link.
 *   - unknown purpose values are 400'd.
 *
 * Uses the same supertest + mocked-auth scaffolding as share-bff-url.integration.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const originalEnv = { ...process.env };

// Pass-through auth that lets the test inject `req.agentContext` upstream
// before the share router runs. Defaults to a basic-auth user-flow context.
vi.mock('../../middleware/jwt-auth.js', () => ({
  jwtAuthMiddleware: {
    authenticate: (req: any, _res: any, next: any) => {
      req.agentContext = req.agentContext ?? {
        siteId: req.params?.id ?? 'test-app',
        authType: 'basic',
      };
      next();
    },
  },
}));

vi.mock('../../middleware/product-access.js', () => ({
  validateProductAccess: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../middleware/app-ownership.js', () => ({
  validateAppOwnership: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../../database/repositories/index.js', () => ({
  appRepository: { findById: vi.fn() },
  shareTokenRepository: {
    create: vi.fn(),
    findByAppId: vi.fn(),
    findByToken: vi.fn(),
    markFirstUsed: vi.fn(),
  },
}));

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { appRepository, shareTokenRepository } from '../../../database/repositories/index.js';

const mockAppRepo = vi.mocked(appRepository);
const mockShareTokenRepo = vi.mocked(shareTokenRepository);

const TEST_APP_ID = 'k8bnu24pcq';
const TEST_TOKEN = 'yPBorcyKvnYJ';
const FUTURE = Date.now() + 7 * 24 * 60 * 60 * 1000;

function appOf(previewUrl: string | null) {
  return {
    id: TEST_APP_ID,
    name: 'Test App',
    path: '/tmp/test',
    port: 5000,
    previewUrl,
    status: 'running',
    initialBuildComplete: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

/**
 * Mount the share router behind an express app that lets each test inject the
 * authType seen by the route. Without this, every request would default to
 * `basic` and we couldn't exercise the cert2s code path.
 */
async function mountShareAppWithAuth(authType: string, ssoRequired = false): Promise<express.Application> {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.agentContext = { siteId: TEST_APP_ID, authType, ssoRequired };
    next();
  });
  const { default: router } = await import('../share.js');
  app.use('/', router);
  return app;
}

describe('POST /apps/:id/share — purpose gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AIRO_BFF_DOMAIN = 'airo.ai';
    mockAppRepo.findById.mockReturnValue(
      appOf(`https://${TEST_APP_ID}.preview.c4.test-airoapp.ai`),
    );
    mockShareTokenRepo.findByAppId.mockReturnValue([]);
    mockShareTokenRepo.create.mockReturnValue({
      token: TEST_TOKEN,
      appId: TEST_APP_ID,
      expiresAt: FUTURE,
      purpose: 'user',
      createdAt: new Date(),
      firstUsedAt: null,
    } as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('cert2s caller minting archive_snapshot', () => {
    it('mints an archive_snapshot token when authType is cert2s', async () => {
      mockShareTokenRepo.create.mockReturnValueOnce({
        token: TEST_TOKEN,
        appId: TEST_APP_ID,
        expiresAt: Date.now() + 15 * 60 * 1000,
        purpose: 'archive_snapshot',
        createdAt: new Date(),
        firstUsedAt: null,
      } as any);

      const app = await mountShareAppWithAuth('cert2s');
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'archive_snapshot', expiresIn: 900 });

      expect(res.status).toBe(201);
      expect(res.body.purpose).toBe('archive_snapshot');
      expect(mockShareTokenRepo.create).toHaveBeenCalledWith({
        appId: TEST_APP_ID,
        expiresIn: 900,
        purpose: 'archive_snapshot',
      });
    });

    it('uses the archive_snapshot default TTL (15 min) when expiresIn is omitted', async () => {
      const app = await mountShareAppWithAuth('cert2s');
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'archive_snapshot' });

      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalledWith({
        appId: TEST_APP_ID,
        expiresIn: 900, // 15 minutes
        purpose: 'archive_snapshot',
      });
    });

    it('rejects archive_snapshot expiresIn above the 15-min ceiling', async () => {
      const app = await mountShareAppWithAuth('cert2s');
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'archive_snapshot', expiresIn: 3600 });

      expect(res.status).toBe(400);
      expect(res.body.error).toEqual(expect.stringContaining('archive_snapshot'));
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });

    it('rejects archive_snapshot expiresIn below the 60s floor', async () => {
      const app = await mountShareAppWithAuth('cert2s');
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'archive_snapshot', expiresIn: 30 });

      expect(res.status).toBe(400);
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('non-cert2s callers cannot mint archive_snapshot', () => {
    it.each(['basic', 'e2s', 's2s'])(
      '403s when authType=%s requests archive_snapshot',
      async (authType) => {
        const app = await mountShareAppWithAuth(authType);
        const res = await request(app)
          .post(`/apps/${TEST_APP_ID}/share`)
          .send({ purpose: 'archive_snapshot' });

        expect(res.status).toBe(403);
        expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('default purpose preserves user-flow contract', () => {
    it('omitted purpose defaults to "user" with the legacy 7-day TTL ceiling', async () => {
      const app = await mountShareAppWithAuth('basic');
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ expiresIn: 604800 });

      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalledWith({
        appId: TEST_APP_ID,
        expiresIn: 604800,
        purpose: 'user',
      });
    });

    it('user purpose still rejects expiresIn outside the 1h–7d window', async () => {
      const app = await mountShareAppWithAuth('basic');
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'user', expiresIn: 60 }); // below 3600

      expect(res.status).toBe(400);
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('coexistence and one-active-link scoping', () => {
    it('user link and archive_snapshot link can coexist (different purpose slots)', async () => {
      // findByAppId is called with the purpose filter — the route's guard only
      // sees tokens for the requested purpose. Cert2s asks for archive_snapshot,
      // and the user-purpose row already in the DB shouldn't trigger 409.
      mockShareTokenRepo.findByAppId.mockImplementation(function (_appId: string, purpose?: string) {
        if (purpose === 'archive_snapshot') return [];
        return [
          {
            token: 'existing-user-token',
            appId: TEST_APP_ID,
            expiresAt: FUTURE,
            purpose: 'user',
            createdAt: new Date(),
            firstUsedAt: null,
          } as any,
        ];
      });

      const app = await mountShareAppWithAuth('cert2s');
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'archive_snapshot' });

      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'archive_snapshot' }),
      );
    });

    it('archive_snapshot bypasses the one-active guard so hosting can re-mint on retry', async () => {
      // The one-active 409 protects user-link UX (stable copyable URL).
      // archive_snapshot has no copyable-URL semantics — hosting must be
      // able to re-mint when an SM step retries — so the guard doesn't
      // apply. The previous token is left in place to expire on its own.
      mockShareTokenRepo.findByAppId.mockReturnValue([
        {
          token: 'existing-snap',
          appId: TEST_APP_ID,
          expiresAt: FUTURE,
          purpose: 'archive_snapshot',
          createdAt: new Date(),
          firstUsedAt: null,
        } as any,
      ]);

      const app = await mountShareAppWithAuth('cert2s');
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'archive_snapshot' });

      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'archive_snapshot' }),
      );
    });
  });

  describe('purpose value validation', () => {
    it('400s when purpose is an unknown string', async () => {
      const app = await mountShareAppWithAuth('cert2s');
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'something-else' });

      expect(res.status).toBe(400);
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('Auth-at-Edge SSO gate', () => {
    // Inline gate at routes/share.ts:238 blocks purpose:'user' when the agent
    // JWT carries ssoRequired:true. archive_snapshot (cert2s) intentionally
    // bypasses — hosting needs to keep capturing screenshots regardless of
    // SSO state.
    it('rejects purpose:"user" with 403 sso_share_disabled when ssoRequired is true', async () => {
      const app = await mountShareAppWithAuth('basic', /* ssoRequired */ true);
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'user', expiresIn: 3600 });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('sso_share_disabled');
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });

    it('allows purpose:"archive_snapshot" with cert2s + ssoRequired:true (system bypass preserved)', async () => {
      // cert2s is the trusted system path used by hosting for archive
      // screenshots. SSO does not gate it — blocking would break archive
      // captures on ent apps.
      const app = await mountShareAppWithAuth('cert2s', /* ssoRequired */ true);
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'archive_snapshot' });

      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'archive_snapshot' }),
      );
    });

    it('allows purpose:"user" when ssoRequired is false (non-ent unaffected)', async () => {
      // Regression guard: an inverted gate would break every existing AAB
      // customer. Non-ent traffic must keep working unchanged.
      const app = await mountShareAppWithAuth('basic', /* ssoRequired */ false);
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ purpose: 'user', expiresIn: 3600 });

      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'user' }),
      );
    });
  });
});
