/**
 * Share redirect page tests.
 *
 * The page is a Server Component that decodes a base64url payload and calls
 * Next.js `redirect()`. We mock `next/navigation` so `redirect()` is a spy and
 * assert the target it was called with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeSharePayload } from '@airo/shared';

const mockRedirect = vi.hoisted(() => vi.fn());
const mockNotFound = vi.hoisted(() => vi.fn(function () {
  throw new Error('NEXT_NOT_FOUND');
}));
vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
  notFound: mockNotFound,
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

const mockGasketConfig = vi.hoisted(() => ({ airoAppDomain: 'test-airoapp.ai' as string | undefined }));
vi.mock('../../../../../gasket.ts', () => ({
  default: { config: mockGasketConfig },
}));

import SharePage from './page';

function paramsOf(encoded: string) {
  return Promise.resolve({ market: 'en-US', encoded });
}

describe('SharePage (Server Component)', () => {
  beforeEach(() => {
    mockRedirect.mockReset();
    mockNotFound.mockReset();
    mockNotFound.mockImplementation(function () {
      throw new Error('NEXT_NOT_FOUND');
    });
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockGasketConfig.airoAppDomain = 'test-airoapp.ai';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('happy path', () => {
    it('redirects to the preview URL with airoShareToken when payload is valid', async () => {
      const encoded = encodeSharePayload({
        siteId: 'k8bnu24pcq',
        cellPrefix: 'c4',
        token: 'yPBorcyKvnYJ',
      });

      await SharePage({ params: paramsOf(encoded) });

      expect(mockRedirect).toHaveBeenCalledTimes(1);
      expect(mockRedirect).toHaveBeenCalledWith(
        'https://k8bnu24pcq.preview.c4.test-airoapp.ai?airoShareToken=yPBorcyKvnYJ',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'share.redirect.success',
        expect.objectContaining({ siteId: 'k8bnu24pcq', cellPrefix: 'c4' }),
      );
    });

    it('preserves a multi-digit cellPrefix', async () => {
      const encoded = encodeSharePayload({
        siteId: 'k8bnu24pcq',
        cellPrefix: 'c36',
        token: 'yPBorcyKvnYJ',
      });

      await SharePage({ params: paramsOf(encoded) });

      expect(mockRedirect).toHaveBeenCalledWith(
        'https://k8bnu24pcq.preview.c36.test-airoapp.ai?airoShareToken=yPBorcyKvnYJ',
      );
    });

    it('uses the production domain when gasket config provides it', async () => {
      mockGasketConfig.airoAppDomain = 'airoapp.ai';
      const encoded = encodeSharePayload({
        siteId: 'k8bnu24pcq',
        cellPrefix: 'c4',
        token: 'yPBorcyKvnYJ',
      });

      await SharePage({ params: paramsOf(encoded) });

      expect(mockRedirect).toHaveBeenCalledWith(
        'https://k8bnu24pcq.preview.c4.airoapp.ai?airoShareToken=yPBorcyKvnYJ',
      );
    });
  });

  describe('invalid payload', () => {
    it('returns notFound() when encoded payload cannot be decoded', async () => {
      await expect(
        SharePage({ params: paramsOf('not-a-valid-payload!!!') }),
      ).rejects.toThrow('NEXT_NOT_FOUND');

      expect(mockNotFound).toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'share.redirect.invalidPayload',
        expect.objectContaining({
          encodedLength: 'not-a-valid-payload!!!'.length,
          encodedPrefix: 'not-a-va',
        }),
      );
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('returns notFound() on injection attempts (dot in siteId)', async () => {
      // Hand-crafted payload that bypasses encode validation by going
      // straight to Buffer.from. The decode-side regexes must reject it.
      const malicious = Buffer.from('evil.com:c4:yPBorcyKvnYJ', 'utf8').toString('base64url');

      await expect(SharePage({ params: paramsOf(malicious) })).rejects.toThrow(
        'NEXT_NOT_FOUND',
      );
      expect(mockNotFound).toHaveBeenCalled();
      // Must NOT have called redirect with a constructed hostname
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('returns notFound() when one field of the payload is empty', async () => {
      const empty = Buffer.from(':c4:yPBorcyKvnYJ', 'utf8').toString('base64url');

      await expect(SharePage({ params: paramsOf(empty) })).rejects.toThrow(
        'NEXT_NOT_FOUND',
      );
      expect(mockNotFound).toHaveBeenCalled();
    });

    it('returns notFound() when payload has the wrong number of fields', async () => {
      const wrongFields = Buffer.from('only:two', 'utf8').toString('base64url');

      await expect(SharePage({ params: paramsOf(wrongFields) })).rejects.toThrow(
        'NEXT_NOT_FOUND',
      );
      expect(mockNotFound).toHaveBeenCalled();
    });
  });

  describe('unauthenticated reachability (regression guard)', () => {
    it('Gasket auth config has no authRoutes — proxy middleware stays a no-op', async () => {
      // @godaddy/gasket-plugin-auth/lib/express.js short-circuits the
      // route-protection middleware when authRoutes is undefined or empty.
      // If anyone adds an authRoutes entry that matches /share/*, share
      // recipients without an SSO session will be redirected to login,
      // breaking the public-share use case. This test guards against that
      // regression by asserting the config remains absent.
      //
      // importActual loads the real gasket.ts module (the vi.mock above
      // stubs only the airoAppDomain access for buildPreviewUrl).
      const realGasket = await vi.importActual<typeof import('../../../../../gasket')>(
        '../../../../../gasket',
      );
      const authConfig = (realGasket.default.config as { auth?: { authRoutes?: unknown } })?.auth;
      expect(authConfig?.authRoutes).toBeUndefined();
    });
  });
});
