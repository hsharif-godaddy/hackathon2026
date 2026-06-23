import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../utils/gd-env.js', () => ({
  resolveEnv: () => 'dev' as const,
}));

describe('switchboard service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('getSwitchboardFlag returns default when not initialized', async () => {
    const { getSwitchboardFlag } = await import('../switchboard.js');
    const result: boolean = getSwitchboardFlag('some-flag', false);
    expect(result).toBe(false);
  });

  it('getSwitchboardFlag returns custom default when not initialized', async () => {
    const { getSwitchboardFlag } = await import('../switchboard.js');
    const result: boolean = getSwitchboardFlag('some-flag', true);
    expect(result).toBe(true);
  });

  it('getSwitchboardFlag returns value from client when initialized', async () => {
    const mockGetValue = vi.fn().mockReturnValue(true);
    const mockClient = { getValue: mockGetValue };

    vi.doMock('@switchboard/client', () => ({
      startClient: vi.fn().mockResolvedValue(mockClient),
      getClient: vi.fn().mockReturnValue(mockClient),
      destroyAllClients: vi.fn(),
    }));

    const { initSwitchboard, getSwitchboardFlag } = await import('../switchboard.js');
    await initSwitchboard();

    const result: boolean = getSwitchboardFlag('appbuilder-valkey-enabled', false, { shopperId: '4367373' });

    expect(result).toBe(true);
    expect(mockGetValue).toHaveBeenCalledWith(
      'default|airo-app-builder',
      'appbuilder-valkey-enabled',
      { shopperId: '4367373' },
      false,
    );
  });

  it('getSwitchboardFlag returns default when client.getValue throws', async () => {
    const mockClient = {
      getValue: vi.fn().mockImplementation(() => { throw new Error('network error'); }),
    };

    vi.doMock('@switchboard/client', () => ({
      startClient: vi.fn().mockResolvedValue(mockClient),
      getClient: vi.fn().mockReturnValue(mockClient),
      destroyAllClients: vi.fn(),
    }));

    const { initSwitchboard, getSwitchboardFlag } = await import('../switchboard.js');
    await initSwitchboard();

    const result: boolean = getSwitchboardFlag('some-flag', false);
    expect(result).toBe(false);
  });

  it('getShopperFlag passes shopperId as criteria', async () => {
    const mockGetValue = vi.fn().mockReturnValue(true);
    const mockClient = { getValue: mockGetValue };

    vi.doMock('@switchboard/client', () => ({
      startClient: vi.fn().mockResolvedValue(mockClient),
      getClient: vi.fn().mockReturnValue(mockClient),
      destroyAllClients: vi.fn(),
    }));

    const { initSwitchboard, getShopperFlag } = await import('../switchboard.js');
    await initSwitchboard();

    const result: boolean = getShopperFlag('appbuilder-valkey-enabled', '4367373');

    expect(result).toBe(true);
    expect(mockGetValue).toHaveBeenCalledWith(
      'default|airo-app-builder',
      'appbuilder-valkey-enabled',
      { shopperId: '4367373' },
      false,
    );
  });

  it('getShopperFlag returns default when shopperId is undefined', async () => {
    const { getShopperFlag } = await import('../switchboard.js');
    const result: boolean = getShopperFlag('some-flag', undefined, true);
    expect(result).toBe(true);
  });

  it('destroySwitchboard calls destroyAllClients', async () => {
    const mockDestroyAll = vi.fn();
    const mockClient = { getValue: vi.fn() };

    vi.doMock('@switchboard/client', () => ({
      startClient: vi.fn().mockResolvedValue(mockClient),
      getClient: vi.fn().mockReturnValue(mockClient),
      destroyAllClients: mockDestroyAll,
    }));

    const { initSwitchboard, destroySwitchboard } = await import('../switchboard.js');
    await initSwitchboard();
    destroySwitchboard();

    expect(mockDestroyAll).toHaveBeenCalled();
  });
});
