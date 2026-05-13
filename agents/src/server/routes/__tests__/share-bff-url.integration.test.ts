/**
 * Share BFF URL Integration Tests
 *
 * Covers the new /share/{encoded} BFF redirect URL emission contract:
 * - POST emits the BFF URL when the preview URL has a cell prefix.
 * - POST falls back to the legacy direct-preview URL when the preview URL has
 *   no cell prefix (local/dev environments).
 * - POST falls back to legacy when appId fails the codec's siteId charset
 *   (e.g. UUID-format ids that exceed 32 chars).
 * - GET emits BFF URLs for each listed token under the same conditions.
 *
 * Uses supertest against a real Express app with mocked auth middleware so
 * routes execute end-to-end (in contrast to share.integration.test.ts which
 * predates this approach and uses a vacuous handler-extraction pattern).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const originalEnv = { ...process.env };

// Pass-through auth middleware: real middleware require valid JWT + ownership;
// for these tests we just inject a synthetic context and call next().
vi.mock('../../middleware/jwt-auth.js', () => ({
  jwtAuthMiddleware: {
    authenticate: (req: any, _res: any, next: any) => {
      req.agentContext = req.agentContext ?? { siteId: req.params?.id ?? 'test-app' };
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

async function mountShareApp(): Promise<express.Application> {
  const app = express();
  app.use(express.json());
  const { default: router } = await import('../share.js');
  app.use('/', router);
  return app;
}

describe('share BFF URL emission (POST /apps/:id/share)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AIRO_BFF_DOMAIN = 'airo.ai';
    // Default: no existing tokens (so the one-active-link guard lets create
    // proceed). Per-test cases that need to test the 409 path override this.
    mockShareTokenRepo.findByAppId.mockReturnValue([]);
    mockShareTokenRepo.create.mockReturnValue({
      token: TEST_TOKEN,
      appId: TEST_APP_ID,
      expiresAt: FUTURE,
      createdAt: new Date(),
      firstUsedAt: null,
    } as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('emits the BFF URL when preview URL has a cell prefix', async () => {
    mockAppRepo.findById.mockReturnValue(
      appOf(`https://${TEST_APP_ID}.preview.c4.test-airoapp.ai`),
    );

    const app = await mountShareApp();
    const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

    expect(res.status).toBe(201);
    expect(res.body.shareUrl).toMatch(
      /^https:\/\/airo\.ai\/share\/[A-Za-z0-9_-]+$/,
    );

    // Round-trip: the encoded segment must decode back to siteId:cellPrefix:token
    const encoded = res.body.shareUrl.split('/share/')[1];
    const plaintext = Buffer.from(encoded, 'base64url').toString('utf8');
    expect(plaintext).toBe(`${TEST_APP_ID}:c4:${TEST_TOKEN}`);
  });

  it('preserves the cell prefix from the preview URL (c36, not default c4)', async () => {
    mockAppRepo.findById.mockReturnValue(
      appOf(`https://${TEST_APP_ID}.preview.c36.airoapp.ai`),
    );

    const app = await mountShareApp();
    const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

    const encoded = res.body.shareUrl.split('/share/')[1];
    const plaintext = Buffer.from(encoded, 'base64url').toString('utf8');
    expect(plaintext).toBe(`${TEST_APP_ID}:c36:${TEST_TOKEN}`);
  });

  it('honors AIRO_BFF_DOMAIN env override', async () => {
    process.env.AIRO_BFF_DOMAIN = 'override.example.com';
    mockAppRepo.findById.mockReturnValue(
      appOf(`https://${TEST_APP_ID}.preview.c4.test-airoapp.ai`),
    );

    const app = await mountShareApp();
    const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

    expect(res.body.shareUrl).toMatch(/^https:\/\/override\.example\.com\/share\//);
  });

  describe('BFF domain derivation (when AIRO_BFF_DOMAIN unset)', () => {
    beforeEach(() => {
      delete process.env.AIRO_BFF_DOMAIN;
    });

    it('emits airo-builder.test-godaddy.com when preview URL is on .test-airoapp.ai', async () => {
      mockAppRepo.findById.mockReturnValue(
        appOf(`https://${TEST_APP_ID}.preview.c4.test-airoapp.ai`),
      );

      const app = await mountShareApp();
      const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

      expect(res.body.shareUrl).toMatch(/^https:\/\/airo-builder\.test-godaddy\.com\/share\//);
    });

    it('falls back to airo.ai (prod canonical) when preview URL is on .airoapp.ai', async () => {
      mockAppRepo.findById.mockReturnValue(
        appOf(`https://${TEST_APP_ID}.preview.c4.airoapp.ai`),
      );

      const app = await mountShareApp();
      const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

      expect(res.body.shareUrl).toMatch(/^https:\/\/airo\.ai\/share\//);
    });

    it('falls back to airo.ai for any other preview-URL TLD', async () => {
      // Unknown TLD → fall through to FALLBACK_BFF_DOMAIN. We default to
      // prod so a misconfigured non-prod env emits prod URLs that 404
      // visibly against the real prod BFF rather than silently routing to
      // a different env.
      mockAppRepo.findById.mockReturnValue(
        appOf(`https://${TEST_APP_ID}.preview.c4.example.com`),
      );

      const app = await mountShareApp();
      const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

      expect(res.body.shareUrl).toMatch(/^https:\/\/airo\.ai\/share\//);
    });

    it('AIRO_BFF_DOMAIN takes precedence over preview-URL derivation', async () => {
      process.env.AIRO_BFF_DOMAIN = 'override.example.com';
      mockAppRepo.findById.mockReturnValue(
        appOf(`https://${TEST_APP_ID}.preview.c4.airoapp.ai`),
      );

      const app = await mountShareApp();
      const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

      expect(res.body.shareUrl).toMatch(/^https:\/\/override\.example\.com\/share\//);
    });

    it('does NOT pick airo.ai for *.test-airoapp.ai (substring trap)', async () => {
      // `test-airoapp.ai` ends with `airoapp.ai` — naive substring matching
      // would incorrectly route test traffic to prod. Confirm we don't.
      mockAppRepo.findById.mockReturnValue(
        appOf(`https://${TEST_APP_ID}.preview.c9.test-airoapp.ai`),
      );

      const app = await mountShareApp();
      const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

      expect(res.body.shareUrl).toMatch(/^https:\/\/airo-builder\.test-godaddy\.com\/share\//);
      expect(res.body.shareUrl).not.toContain('airo.ai/share');
    });
  });

  it('falls back to legacy URL when preview URL has no cell prefix', async () => {
    // Local-dev style hostname without the .cN. segment
    mockAppRepo.findById.mockReturnValue(
      appOf(`https://${TEST_APP_ID}.preview.test-godaddy.com`),
    );

    const app = await mountShareApp();
    const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

    expect(res.status).toBe(201);
    expect(res.body.shareUrl).toBe(
      `https://${TEST_APP_ID}.preview.test-godaddy.com?airoShareToken=${TEST_TOKEN}`,
    );
  });

  it('returns 400 when app has no preview URL configured', async () => {
    mockAppRepo.findById.mockReturnValue(appOf(null));

    const app = await mountShareApp();
    const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'App has no preview URL configured' });
    // Token must NOT be created when app is misconfigured
    expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
  });

  it('returns 404 when app does not exist', async () => {
    mockAppRepo.findById.mockReturnValue(null);

    const app = await mountShareApp();
    const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'App not found' });
    expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
  });

  it('prepends https:// when previewUrl is hostname-only (Nomad templates)', async () => {
    // Nomad templates store hostname-only values; getPreviewBaseUrl prepends
    // https:// before downstream consumers see it
    mockAppRepo.findById.mockReturnValue(
      appOf(`${TEST_APP_ID}.preview.c4.test-airoapp.ai`),
    );

    const app = await mountShareApp();
    const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

    expect(res.status).toBe(201);
    // Should still produce a BFF URL (cell prefix extractable from prepended URL)
    expect(res.body.shareUrl).toMatch(
      /^https:\/\/airo\.ai\/share\/[A-Za-z0-9_-]+$/,
    );
  });

  it('falls back to legacy URL when appId is UUID-format (too long for codec)', async () => {
    // UUID is 36 chars — exceeds SITE_ID_REGEX 32-char cap; encode would throw.
    // buildShareUrl must catch this BEFORE encode and emit legacy without
    // failing the share-create call.
    const uuidAppId = '550e8400-e29b-41d4-a716-446655440000';
    const previewWithCell = `https://${uuidAppId}.preview.c4.airoapp.ai`;

    mockAppRepo.findById.mockReturnValue({
      ...appOf(previewWithCell),
      id: uuidAppId,
    });

    // shareToken returned from create still has the right token
    mockShareTokenRepo.create.mockReturnValue({
      token: TEST_TOKEN,
      appId: uuidAppId,
      expiresAt: FUTURE,
      createdAt: new Date(),
      firstUsedAt: null,
    } as any);

    const app = await mountShareApp();
    const res = await request(app).post(`/apps/${uuidAppId}/share`).send({});

    expect(res.status).toBe(201);
    // Must be legacy form, not BFF (which would be undecodeable)
    expect(res.body.shareUrl).toBe(`${previewWithCell}?airoShareToken=${TEST_TOKEN}`);
    expect(res.body.shareUrl).not.toContain('/share/');
  });
});

describe('share BFF URL emission (GET /apps/:id/share)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AIRO_BFF_DOMAIN = 'airo.ai';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns BFF URLs for each token when preview URL has cell prefix', async () => {
    mockAppRepo.findById.mockReturnValue(
      appOf(`https://${TEST_APP_ID}.preview.c4.test-airoapp.ai`),
    );
    mockShareTokenRepo.findByAppId.mockReturnValue([
      {
        token: 'yPBorcyKvnYJ',
        appId: TEST_APP_ID,
        expiresAt: FUTURE,
        createdAt: new Date('2024-01-01'),
        firstUsedAt: null,
      } as any,
      {
        token: 'H-NQO5LBt0_H',
        appId: TEST_APP_ID,
        expiresAt: FUTURE,
        createdAt: new Date('2024-01-02'),
        firstUsedAt: null,
      } as any,
    ]);

    const app = await mountShareApp();
    const res = await request(app).get(`/apps/${TEST_APP_ID}/share`);

    expect(res.status).toBe(200);
    expect(res.body.tokens).toHaveLength(2);
    for (const t of res.body.tokens) {
      expect(t.shareUrl).toMatch(
        /^https:\/\/airo\.ai\/share\/[A-Za-z0-9_-]+$/,
      );
      const encoded = t.shareUrl.split('/share/')[1];
      const plaintext = Buffer.from(encoded, 'base64url').toString('utf8');
      expect(plaintext).toBe(`${TEST_APP_ID}:c4:${t.token}`);
    }
  });

  it('returns legacy URLs when preview URL has no cell prefix', async () => {
    mockAppRepo.findById.mockReturnValue(
      appOf(`https://${TEST_APP_ID}.preview.test-godaddy.com`),
    );
    mockShareTokenRepo.findByAppId.mockReturnValue([
      {
        token: TEST_TOKEN,
        appId: TEST_APP_ID,
        expiresAt: FUTURE,
        createdAt: new Date(),
        firstUsedAt: null,
      } as any,
    ]);

    const app = await mountShareApp();
    const res = await request(app).get(`/apps/${TEST_APP_ID}/share`);

    expect(res.body.tokens[0].shareUrl).toBe(
      `https://${TEST_APP_ID}.preview.test-godaddy.com?airoShareToken=${TEST_TOKEN}`,
    );
  });

  it('omits shareUrl when preview URL is missing entirely', async () => {
    mockAppRepo.findById.mockReturnValue(appOf(null));
    mockShareTokenRepo.findByAppId.mockReturnValue([
      {
        token: TEST_TOKEN,
        appId: TEST_APP_ID,
        expiresAt: FUTURE,
        createdAt: new Date(),
        firstUsedAt: null,
      } as any,
    ]);

    const app = await mountShareApp();
    const res = await request(app).get(`/apps/${TEST_APP_ID}/share`);

    expect(res.body.tokens[0].shareUrl).toBeUndefined();
  });

  it('falls back to legacy URL when appId is UUID-format (parity with POST)', async () => {
    // buildShareUrl is also called per token on the GET path. A UUID appId
    // (36 chars with dashes) exceeds SITE_ID_REGEX 32-char cap, so each
    // listed token's shareUrl falls back to the legacy direct-preview form
    // rather than producing an undecodeable BFF URL.
    const uuidAppId = '550e8400-e29b-41d4-a716-446655440000';
    const previewWithCell = `https://${uuidAppId}.preview.c4.airoapp.ai`;

    mockAppRepo.findById.mockReturnValue({
      ...appOf(previewWithCell),
      id: uuidAppId,
    });
    mockShareTokenRepo.findByAppId.mockReturnValue([
      {
        token: TEST_TOKEN,
        appId: uuidAppId,
        expiresAt: FUTURE,
        createdAt: new Date(),
        firstUsedAt: null,
      } as any,
    ]);

    const app = await mountShareApp();
    const res = await request(app).get(`/apps/${uuidAppId}/share`);

    expect(res.status).toBe(200);
    expect(res.body.tokens[0].shareUrl).toBe(
      `${previewWithCell}?airoShareToken=${TEST_TOKEN}`,
    );
    expect(res.body.tokens[0].shareUrl).not.toContain('/share/');
  });

  it('returns 200 with empty tokens when the app does not exist', async () => {
    // GET intentionally does NOT 404 when findById returns null (different
    // from POST which uses 404 to refuse the create). It's a list endpoint —
    // an empty list is a valid response. Documenting this behavior so a
    // future refactor that adds a 404 check is intentional, not accidental.
    mockAppRepo.findById.mockReturnValue(null);
    mockShareTokenRepo.findByAppId.mockReturnValue([]);

    const app = await mountShareApp();
    const res = await request(app).get(`/apps/${TEST_APP_ID}/share`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ tokens: [] });
  });
});

describe('share POST validation (expiresIn + one-active-link)', () => {
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
      createdAt: new Date(),
      firstUsedAt: null,
    } as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('expiresIn validation', () => {
    it('returns 400 when expiresIn is not a number', async () => {
      const app = await mountShareApp();
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ expiresIn: '1week' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid expiresIn. Must be a number' });
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });

    it('returns 400 when expiresIn is NaN', async () => {
      const app = await mountShareApp();
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ expiresIn: 'not-a-number' });

      expect(res.status).toBe(400);
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });

    it('returns 400 when expiresIn is below the 1-hour minimum', async () => {
      const app = await mountShareApp();
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ expiresIn: 100 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/3600|7 days/);
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });

    it('returns 400 when expiresIn is above the 7-day maximum', async () => {
      const app = await mountShareApp();
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ expiresIn: 999999 });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/3600|7 days/);
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });

    it('accepts a valid expiresIn at the lower boundary (3600s)', async () => {
      const app = await mountShareApp();
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ expiresIn: 3600 });

      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalledWith({
        appId: TEST_APP_ID,
        expiresIn: 3600,
      });
    });

    it('accepts a valid expiresIn at the upper boundary (604800s = 7 days)', async () => {
      // Catches an off-by-one if someone changes the bound from `> 604800`
      // to `>= 604800`.
      const app = await mountShareApp();
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ expiresIn: 604800 });

      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalledWith({
        appId: TEST_APP_ID,
        expiresIn: 604800,
      });
    });
  });

  describe('one-active-link server-side enforcement', () => {
    it('returns 409 when an unexpired token already exists', async () => {
      mockShareTokenRepo.findByAppId.mockReturnValue([
        {
          token: 'existing-active',
          appId: TEST_APP_ID,
          expiresAt: FUTURE,
          createdAt: new Date(),
          firstUsedAt: null,
        } as any,
      ]);

      const app = await mountShareApp();
      const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: 'An active share link already exists for this app',
      });
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });

    it('allows create when only an expired token exists', async () => {
      mockShareTokenRepo.findByAppId.mockReturnValue([
        {
          token: 'expired',
          appId: TEST_APP_ID,
          expiresAt: Date.now() - 60 * 1000,
          createdAt: new Date(),
          firstUsedAt: null,
        } as any,
      ]);

      const app = await mountShareApp();
      const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalled();
    });
  });

  describe('replaceActive opt-in rotation', () => {
    it('bypasses the 409 guard and creates a new token alongside the existing active one', async () => {
      // Existing active token — the default behavior would 409 here.
      mockShareTokenRepo.findByAppId.mockReturnValue([
        {
          token: 'existing-active',
          appId: TEST_APP_ID,
          expiresAt: FUTURE,
          createdAt: new Date(),
          firstUsedAt: null,
        } as any,
      ]);

      const app = await mountShareApp();
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ replaceActive: true });

      // Create succeeds — caller has explicitly opted into rotation.
      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalledWith({
        appId: TEST_APP_ID,
        expiresIn: 604800,
      });
      // The repository's create call signature does NOT delete or expire the
      // previous token — by design, the previous token continues to live with
      // its original expiresAt so already-copied URLs keep working.
    });

    it('still 409s when replaceActive is omitted (default behavior preserved)', async () => {
      mockShareTokenRepo.findByAppId.mockReturnValue([
        {
          token: 'existing-active',
          appId: TEST_APP_ID,
          expiresAt: FUTURE,
          createdAt: new Date(),
          firstUsedAt: null,
        } as any,
      ]);

      const app = await mountShareApp();
      // No replaceActive in body — UI's manual share-create path.
      const res = await request(app).post(`/apps/${TEST_APP_ID}/share`).send({});

      expect(res.status).toBe(409);
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });

    it('rejects non-boolean truthy values (falls through to default 409)', async () => {
      // Strict `=== true` check: only the literal boolean true opts in. A
      // string "true" or the number 1 must NOT bypass the guard — that would
      // be a silent UX hazard where someone naively casts a query param.
      mockShareTokenRepo.findByAppId.mockReturnValue([
        {
          token: 'existing-active',
          appId: TEST_APP_ID,
          expiresAt: FUTURE,
          createdAt: new Date(),
          firstUsedAt: null,
        } as any,
      ]);

      const app = await mountShareApp();
      // String "true" — not the literal boolean. The route's strict `=== true`
      // check should treat this as not-opted-in.
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ replaceActive: 'true' });

      expect(res.status).toBe(409);
      expect(mockShareTokenRepo.create).not.toHaveBeenCalled();
    });

    it('creates a token cleanly when no existing active token (replaceActive is a no-op)', async () => {
      // No existing tokens — the rotation flag should make no difference vs.
      // the default path. Verifies we don't accidentally introduce a regression
      // for callers who pass replaceActive defensively.
      mockShareTokenRepo.findByAppId.mockReturnValue([]);

      const app = await mountShareApp();
      const res = await request(app)
        .post(`/apps/${TEST_APP_ID}/share`)
        .send({ replaceActive: true });

      expect(res.status).toBe(201);
      expect(mockShareTokenRepo.create).toHaveBeenCalled();
    });
  });
});

describe('share validate (GET /api/share/validate/:token)', () => {
  // The validate endpoint is the gatekeeper that dev-supervisor calls before
  // serving the preview to an unauthenticated visitor. It's a public route
  // (no JWT / ownership middleware), so we mount the router directly.

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns valid + marks first use for an unexpired existing token', async () => {
    mockShareTokenRepo.findByToken.mockReturnValue({
      token: TEST_TOKEN,
      appId: TEST_APP_ID,
      expiresAt: FUTURE,
      createdAt: new Date(),
      firstUsedAt: null,
    } as any);

    const app = await mountShareApp();
    const res = await request(app).get(`/api/share/validate/${TEST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      valid: true,
      appId: TEST_APP_ID,
      expiresAt: FUTURE,
    });
    expect(mockShareTokenRepo.markFirstUsed).toHaveBeenCalledWith(TEST_TOKEN);
  });

  it('returns valid: false reason: expired for an expired token', async () => {
    mockShareTokenRepo.findByToken.mockReturnValue({
      token: TEST_TOKEN,
      appId: TEST_APP_ID,
      expiresAt: Date.now() - 60 * 1000,
      createdAt: new Date(),
      firstUsedAt: null,
    } as any);

    const app = await mountShareApp();
    const res = await request(app).get(`/api/share/validate/${TEST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, reason: 'expired' });
    expect(mockShareTokenRepo.markFirstUsed).not.toHaveBeenCalled();
  });

  it('returns valid: false reason: not_found when token does not exist', async () => {
    mockShareTokenRepo.findByToken.mockReturnValue(null);

    const app = await mountShareApp();
    const res = await request(app).get(`/api/share/validate/${TEST_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, reason: 'not_found' });
    expect(mockShareTokenRepo.markFirstUsed).not.toHaveBeenCalled();
  });

  it('returns valid: false reason: invalid_format without DB lookup for malformed token', async () => {
    const app = await mountShareApp();
    // Length below minimum (8) — fails isValidShareTokenFormat
    const res = await request(app).get('/api/share/validate/short');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ valid: false, reason: 'invalid_format' });
    expect(mockShareTokenRepo.findByToken).not.toHaveBeenCalled();
  });

  it('returns 500 reason: internal_error when DB throws', async () => {
    mockShareTokenRepo.findByToken.mockImplementation(() => {
      throw new Error('SQLITE_BUSY');
    });

    const app = await mountShareApp();
    const res = await request(app).get(`/api/share/validate/${TEST_TOKEN}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ valid: false, reason: 'internal_error' });
  });
});
