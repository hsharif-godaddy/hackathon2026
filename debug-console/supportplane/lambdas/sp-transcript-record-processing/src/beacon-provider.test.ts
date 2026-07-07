import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./sso-jwt.js', () => ({ mintSsoJwt: vi.fn().mockResolvedValue('fake-jwt') }));

import { BeaconAskProvider } from './beacon-provider.js';

const provider = new BeaconAskProvider();

beforeEach(() => {
  vi.stubEnv('S2S_IAM_JWT_ROLE_ARN', 'arn:aws:iam::123:role/s2s');
  vi.stubEnv('SSO_HOST', 'sso.test-godaddy.com');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('BeaconAskProvider', () => {
  it('self-disables when BEACON_API_URL is unset (worker falls through to GoCode)', () => {
    vi.stubEnv('BEACON_API_URL', '');
    expect(provider.isConfigured()).toBe(false);
  });

  it('is configured once BEACON_API_URL + auth are present', () => {
    vi.stubEnv('BEACON_API_URL', 'https://beacon.example');
    expect(provider.isConfigured()).toBe(true);
  });

  it('maps the /api/ask prose message into conversation_summary', async () => {
    vi.stubEnv('BEACON_API_URL', 'https://beacon.example/');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: 'Root cause: DNS. Fix: wait for propagation.' }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await provider.enrich({ interaction_id: 'x', full_transcript: 'could not publish' });

    expect(result).toEqual({
      provider: 'beacon',
      conversation_summary: 'Root cause: DNS. Fix: wait for propagation.',
    });
    // Trailing slash on the base URL is normalized (no `//api/ask`).
    expect(fetchMock).toHaveBeenCalledWith(
      'https://beacon.example/api/ask',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws on a non-OK response', async () => {
    vi.stubEnv('BEACON_API_URL', 'https://beacon.example');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'down' })
    );
    await expect(
      provider.enrich({ interaction_id: 'x', full_transcript: 't' })
    ).rejects.toThrow(/Beacon \/api\/ask error 503/);
  });
});
