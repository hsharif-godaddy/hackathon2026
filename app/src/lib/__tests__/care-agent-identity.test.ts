import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/workers-service/client', () => ({
  resolveCareAgentWorkerId: vi.fn(),
}));

import { logger } from '@/lib/request-context';
import { resolveCareAgentWorkerId } from '@/lib/workers-service/client';
import { resolveCareAgentIdentity } from '../care-agent-identity';

const mockResolveWorkerId = vi.mocked(resolveCareAgentWorkerId);
const mockLogger = vi.mocked(logger);

const ACCOUNT_NAME = 'fgoodwrk';
const HEADERS = new Headers({ host: 'builder.test-godaddy.com' });
const HASH_KEY = 'test-care-agent-key';

function hmacHex(value: string): string {
  return createHmac('sha256', HASH_KEY).update(value).digest('hex');
}

/** Assert the raw username never appears in any logged field (PII guard). */
function assertNoRawUsernameLogged(): void {
  const allCalls: unknown[][] = [
    ...mockLogger.info.mock.calls,
    ...mockLogger.warn.mock.calls,
    ...mockLogger.error.mock.calls,
  ];
  expect(JSON.stringify(allCalls)).not.toContain(ACCOUNT_NAME);
}

describe('resolveCareAgentIdentity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CARE_AGENT_HASH_KEY', HASH_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the worker GUID when the lookup succeeds', async () => {
    mockResolveWorkerId.mockResolvedValue('worker-guid-123');

    const result = await resolveCareAgentIdentity({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });

    expect(result).toEqual({ careAgentId: 'worker-guid-123' });
    expect(mockResolveWorkerId).toHaveBeenCalledWith({
      jwt: 'jwt-token',
      headers: HEADERS,
      accountName: ACCOUNT_NAME,
    });
    assertNoRawUsernameLogged();
  });

  it('falls back to the hashed username when the lookup fails', async () => {
    mockResolveWorkerId.mockResolvedValue(undefined);

    const result = await resolveCareAgentIdentity({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });

    expect(result).toEqual({ careAgentUsernameHash: hmacHex(ACCOUNT_NAME) });
    assertNoRawUsernameLogged();
  });

  it('returns an empty identity (no hash) when no accountName is available and the lookup fails', async () => {
    mockResolveWorkerId.mockResolvedValue(undefined);

    const result = await resolveCareAgentIdentity({ jwt: 'jwt-token', headers: HEADERS });

    expect(result).toEqual({});
  });

  it('emits no hash and warns when the hash key is absent in production', async () => {
    vi.stubEnv('CARE_AGENT_HASH_KEY', '');
    vi.stubEnv('NODE_ENV', 'production');
    mockResolveWorkerId.mockResolvedValue(undefined);

    const result = await resolveCareAgentIdentity({ jwt: 'jwt-token', headers: HEADERS, accountName: ACCOUNT_NAME });

    expect(result).toEqual({});
    expect(mockLogger.warn).toHaveBeenCalledWith('care-agent-identity.hash.no-key', {});
    assertNoRawUsernameLogged();
  });
});
