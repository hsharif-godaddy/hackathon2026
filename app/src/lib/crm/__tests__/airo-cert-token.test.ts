import { EventEmitter } from 'node:events';
import https from 'node:https';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('node:https', () => ({
  default: { request: vi.fn() },
}));

interface MockResponseOptions {
  statusCode?: number;
  body: string;
}

function queueResponse({ statusCode = 200, body }: MockResponseOptions): void {
  const req = new EventEmitter() as EventEmitter & {
    write: () => void;
    end: () => void;
    destroy: () => void;
  };
  req.write = vi.fn();
  req.end = vi.fn();
  req.destroy = vi.fn();

  vi.mocked(https.request).mockImplementationOnce(((_options: unknown, cb: (res: EventEmitter & { statusCode: number }) => void) => {
    const res = new EventEmitter() as EventEmitter & { statusCode: number };
    res.statusCode = statusCode;
    setImmediate(() => {
      cb(res);
      res.emit('data', Buffer.from(body));
      res.emit('end');
    });
    return req;
  }) as unknown as typeof https.request);
}

async function freshService(): Promise<typeof import('../airo-cert-token').airoCertTokenService> {
  vi.resetModules();
  const mod = await import('../airo-cert-token');
  return mod.airoCertTokenService;
}

describe('airoCertTokenService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AIRO_CLIENT_CERT;
    delete process.env.AIRO_CLIENT_KEY;
    delete process.env.AIRO_SSO_ENDPOINT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('isConfigured', () => {
    it('returns false when env vars are unset', async () => {
      const svc = await freshService();
      expect(svc.isConfigured()).toBe(false);
    });

    it('returns false when only one of the two is set', async () => {
      process.env.AIRO_CLIENT_CERT = '-----CERT-----';
      const svc = await freshService();
      expect(svc.isConfigured()).toBe(false);
    });

    it('returns true when both env vars are set', async () => {
      process.env.AIRO_CLIENT_CERT = '-----CERT-----';
      process.env.AIRO_CLIENT_KEY = '-----KEY-----';
      const svc = await freshService();
      expect(svc.isConfigured()).toBe(true);
    });
  });

  describe('getToken', () => {
    it('rejects with a "not set" message when env vars are missing', async () => {
      const svc = await freshService();
      await expect(svc.getToken()).rejects.toThrow(/AIRO_CLIENT_CERT\/AIRO_CLIENT_KEY env vars not set/);
      expect(https.request).not.toHaveBeenCalled();
    });

    it('mints a fresh token via SSO and resolves on 2xx JSON', async () => {
      process.env.AIRO_CLIENT_CERT = '-----CERT-----';
      process.env.AIRO_CLIENT_KEY = '-----KEY-----';
      queueResponse({ body: JSON.stringify({ data: 'sso-jwt-value' }) });

      const svc = await freshService();
      const token = await svc.getToken();
      expect(token).toBe('sso-jwt-value');
      expect(https.request).toHaveBeenCalledTimes(1);
    });

    it('mints a fresh token on every call (no cache)', async () => {
      process.env.AIRO_CLIENT_CERT = '-----CERT-----';
      process.env.AIRO_CLIENT_KEY = '-----KEY-----';
      queueResponse({ body: JSON.stringify({ data: 'tok-1' }) });
      queueResponse({ body: JSON.stringify({ data: 'tok-2' }) });

      const svc = await freshService();
      const a = await svc.getToken();
      const b = await svc.getToken();
      expect(a).toBe('tok-1');
      expect(b).toBe('tok-2');
      expect(https.request).toHaveBeenCalledTimes(2);
    });

    it('rejects when SSO returns 2xx with a non-JSON body', async () => {
      process.env.AIRO_CLIENT_CERT = '-----CERT-----';
      process.env.AIRO_CLIENT_KEY = '-----KEY-----';
      queueResponse({ body: '<html>captive portal</html>' });

      const svc = await freshService();
      await expect(svc.getToken()).rejects.toThrow(/SSO 2xx response was not JSON/);
    });

    // `JSON.parse('null')` succeeds and yields `null`. Without an explicit
    // object guard the subsequent `parsed.data` read throws a sync TypeError
    // inside the `res.on('end')` handler, escaping the Promise and leaving
    // it unsettled until the 10s request timeout.
    it('rejects (without hanging) when SSO returns 2xx body that is JSON but not an object', async () => {
      process.env.AIRO_CLIENT_CERT = '-----CERT-----';
      process.env.AIRO_CLIENT_KEY = '-----KEY-----';
      queueResponse({ body: 'null' });

      const svc = await freshService();
      await expect(svc.getToken()).rejects.toThrow(/SSO 2xx response was not a JSON object/);
    });

    it('rejects when SSO returns 2xx JSON without a recognised token field', async () => {
      process.env.AIRO_CLIENT_CERT = '-----CERT-----';
      process.env.AIRO_CLIENT_KEY = '-----KEY-----';
      queueResponse({ body: JSON.stringify({ unrelated: 'value' }) });

      const svc = await freshService();
      await expect(svc.getToken()).rejects.toThrow(/SSO response missing token field/);
    });

    it('rejects with the SSO status when response is non-2xx', async () => {
      process.env.AIRO_CLIENT_CERT = '-----CERT-----';
      process.env.AIRO_CLIENT_KEY = '-----KEY-----';
      queueResponse({ statusCode: 401, body: 'denied' });

      const svc = await freshService();
      await expect(svc.getToken()).rejects.toThrow(/SSO authentication failed with status 401/);
    });
  });
});
