import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  buildEventCanonical,
  computeEventSignature,
  EVENT_SIG_HEADER,
  postAgentLifecycleEvent,
} from '../client.js';
import { INITIAL_BUILD_ASYNC_EVENTS } from '../event-types.js';

vi.mock('@airo/ai-lib', () => ({
  getS2SToken: vi.fn().mockResolvedValue('mock-s2s-token'),
}));

vi.mock('../../../utils/nomad-config.js', () => ({
  getNomadAllocConfigValue: vi.fn().mockReturnValue('test-signing-key'),
}));

vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const mockFetch = vi.fn();

describe('agent-lifecycle-events client', () => {
  let originalFetch: typeof global.fetch;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
    global.fetch = mockFetch as typeof fetch;
    process.env.MGMT_AIRO_BASE_URL = 'https://mgmt.test.local';
    mockFetch.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  it('builds canonical string matching airo-go AgentEventHMAC', () => {
    const canonical = buildEventCanonical(
      'app-123',
      'deployment.succeeded',
      '2026-06-13T12:00:00Z',
      'idem-abc',
    );
    expect(canonical).toBe('app-123\ndeployment.succeeded\n2026-06-13T12:00:00Z\nidem-abc');
  });

  it('computes unpadded base64url HMAC signatures', () => {
    const canonical = buildEventCanonical(
      'app-123',
      'deployment.succeeded',
      '2026-06-13T12:00:00Z',
      'idem-abc',
    );
    const sig = computeEventSignature('test-signing-key', canonical);
    expect(sig).not.toContain('=');
    expect(sig).not.toContain('+');
    expect(sig).not.toContain('/');
    expect(sig).toBe(computeEventSignature('test-signing-key', canonical));
    expect(sig).not.toBe(computeEventSignature('other-key', canonical));
  });

  it('posts event with sso-jwt auth and HMAC header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => '',
    });

    await postAgentLifecycleEvent('app-abc', INITIAL_BUILD_ASYNC_EVENTS.started);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://mgmt.test.local/api/airo/agent/v1/apps/app-abc/events');
    expect(options.method).toBe('POST');

    const headers = options.headers as Record<string, string>;
    expect(headers.Authorization).toBe('sso-jwt mock-s2s-token');
    expect(headers[EVENT_SIG_HEADER]).toBeTruthy();

    const body = JSON.parse(options.body as string);
    expect(body.eventType).toBe(INITIAL_BUILD_ASYNC_EVENTS.started);
    expect(body.occurredAt).toBeTruthy();
    expect(body.idempotencyKey).toBeTruthy();

    const expectedSig = computeEventSignature(
      'test-signing-key',
      buildEventCanonical('app-abc', body.eventType, body.occurredAt, body.idempotencyKey),
    );
    expect(headers[EVENT_SIG_HEADER]).toBe(expectedSig);
  });

  it('skips post when appId is empty', async () => {
    await postAgentLifecycleEvent('', INITIAL_BUILD_ASYNC_EVENTS.started);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
