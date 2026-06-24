import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSetAppVenture = vi.fn();

vi.mock('@/lib/mgmt-airo', () => ({
  // Regular function (not arrow): the source does `new AiroMgmtClient()`, and an
  // arrow-fn mockImplementation throws "is not a constructor" under vitest.
  AiroMgmtClient: vi.fn().mockImplementation(function () {
    return { setAppVenture: mockSetAppVenture };
  }),
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AiroMgmtClient } from '@/lib/mgmt-airo';
import { setAppVentureMappingBestEffort } from '@/lib/mgmt-airo/set-venture-mapping';

describe('mgmt-airo/set-venture-mapping', function setVentureMappingTests() {
  beforeEach(function setup() {
    mockSetAppVenture.mockReset().mockResolvedValue(undefined);
    vi.mocked(AiroMgmtClient).mockClear();
  });

  afterEach(function cleanup() {
    vi.clearAllMocks();
  });

  it('writes the mapping with (subscriptionId, appId, ventureId)', async function writes() {
    await setAppVentureMappingBestEffort({
      jwt: 'tok',
      appId: 'app-1',
      subscriptionId: 'sub-1',
      ventureId: 'ven-1',
    });
    expect(mockSetAppVenture).toHaveBeenCalledWith('sub-1', 'app-1', 'ven-1');
  });

  it('is a no-op when the subscription id is missing (no client constructed)', async function noSub() {
    await setAppVentureMappingBestEffort({ jwt: 'tok', appId: 'app-1', ventureId: 'ven-1' });
    expect(AiroMgmtClient).not.toHaveBeenCalled();
    expect(mockSetAppVenture).not.toHaveBeenCalled();
  });

  it('is a no-op when the venture id is missing', async function noVenture() {
    await setAppVentureMappingBestEffort({ jwt: 'tok', appId: 'app-1', subscriptionId: 'sub-1' });
    expect(mockSetAppVenture).not.toHaveBeenCalled();
  });

  it('never throws when the mgmt-airo call fails (best-effort)', async function swallows() {
    mockSetAppVenture.mockRejectedValue(new Error('mgmt 500'));
    await expect(
      setAppVentureMappingBestEffort({
        jwt: 'tok',
        appId: 'app-1',
        subscriptionId: 'sub-1',
        ventureId: 'ven-1',
      }),
    ).resolves.toBeUndefined();
  });
});
