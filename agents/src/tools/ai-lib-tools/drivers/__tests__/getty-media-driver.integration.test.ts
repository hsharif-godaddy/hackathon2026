/**
 * Getty Media Driver — Live Integration Test
 *
 * Validates that the agent's S2S auth path is accepted by the GoDaddy Getty
 * Images proxy (`api.{test-,}godaddy.com/getty-proxy`). This is the
 * key open question for the migration off the airo-proxy: Getty's allowlist
 * may only contain the cert-based identity, in which case S2S returns 401
 * and we have to fall back to mounting Getty client certs.
 *
 * Skip conditions (test self-skips, never fails open):
 * - INTEGRATION_TEST !== '1' (default — keeps `test:integration` runs offline-safe)
 * - Neither GOCODE_USE_S2S_AUTH=true nor SSO_JWT is set
 *
 * To run:
 *   AWS_PROFILE=airobuild-dev-private-sso aws sso login
 *   INTEGRATION_TEST=1 GOCODE_USE_S2S_AUTH=true \
 *     pnpm --filter @airo/agents test:integration "getty-media-driver"
 *
 * Or in local dev with a cert-minted JWT:
 *   INTEGRATION_TEST=1 SSO_JWT="<jwt>" \
 *     pnpm --filter @airo/agents test:integration "getty-media-driver"
 *
 * If this returns a 401 from the Getty proxy, agents cannot use the S2S
 * path and the cert-based fallback plan must be executed.
 */
import { describe, it, expect } from 'vitest';
import { GettyMediaDriver } from '../getty-media-driver.js';

const SHOULD_RUN =
  process.env.INTEGRATION_TEST === '1' &&
  (process.env.GOCODE_USE_S2S_AUTH === 'true' || !!process.env.SSO_JWT);

describe.skipIf(!SHOULD_RUN)('GettyMediaDriver — live integration', () => {
  it('returns image results from getty-images-proxy with S2S/SSO_JWT auth', async () => {
    const driver = new GettyMediaDriver();

    const result = await driver.search({
      query: 'business meeting',
      count: 3,
    });

    if (!result.success) {
      // Surface the upstream error so the next person debugging this knows
      // exactly which auth flow returned 401.
      console.error(
        '[getty-integration] search failed:',
        result.error,
        '\nauth mode:',
        process.env.GOCODE_USE_S2S_AUTH === 'true' ? 's2s' : 'sso_jwt',
        '\nbase URL:',
        // @ts-expect-error accessing protected field for diagnostic output
        driver.apiBaseUrl,
      );
    }

    expect(result.success).toBe(true);
    expect(result.items).toBeDefined();
    expect(result.items!.length).toBeGreaterThan(0);
    expect(result.items![0]!.id).toMatch(/^\d+$/);
  }, 30000);
});
