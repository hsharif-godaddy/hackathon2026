import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@opentelemetry/api', () => ({
  trace: { getActiveSpan: vi.fn(() => null) },
}));

vi.mock('../../../logging/index.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  Logger: {
    create: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  },
}));

vi.mock('../../../services/vite-dedupe.js', () => ({
  ensureViteResolveDedupe: vi.fn(),
}));

const { ensureViteResolveDedupe } = await import('../../../services/vite-dedupe.js');
const { getBookingConfigTool, hooks } = await import('../tools/index.js');

describe('getBookingConfigTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('execute', () => {
    it('returns config when appId is present', async () => {
      const result = await getBookingConfigTool.execute(
        {},
        { metadata: { appId: 'testapp123' } }
      );
      expect(result).toMatchObject({
        paymentProvider: 'godaddy-commerce',
        message: expect.stringContaining('GoDaddy Commerce'),
      });
      expect(result).not.toHaveProperty('error');
    });

    it('still returns config when appId is absent', async () => {
      const result = await getBookingConfigTool.execute({}, {});
      expect(result).toMatchObject({
        paymentProvider: 'godaddy-commerce',
        message: expect.stringContaining('GoDaddy Commerce'),
      });
      expect(result).not.toHaveProperty('error');
    });
  });

  describe('computeState', () => {
    it('returns state with paymentProvider and queriedAt', () => {
      const state = getBookingConfigTool.computeState!(
        {},
        { paymentProvider: 'godaddy-commerce', message: 'test' }
      );
      expect(state).toMatchObject({
        paymentProvider: 'godaddy-commerce',
        queriedAt: expect.any(String),
      });
    });

    it('returns null when output has no paymentProvider', () => {
      expect(getBookingConfigTool.computeState!({}, {})).toBeNull();
    });

    it('returns null when output is null', () => {
      expect(getBookingConfigTool.computeState!({}, null)).toBeNull();
    });
  });
});

describe('hooks.onInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls ensureViteResolveDedupe with appPath when present', async () => {
    vi.mocked(ensureViteResolveDedupe).mockImplementation(() => {});
    await hooks.onInstall!({ skillName: 'online-appointments', appPath: '/app/path' });
    expect(ensureViteResolveDedupe).toHaveBeenCalledWith('/app/path');
  });

  it('rethrows when ensureViteResolveDedupe throws', async () => {
    const error = new Error('dedupe failed');
    vi.mocked(ensureViteResolveDedupe).mockImplementation(() => { throw error; });
    await expect(
      hooks.onInstall!({ skillName: 'online-appointments', appPath: '/app/path' })
    ).rejects.toThrow('dedupe failed');
  });

  it('skips ensureViteResolveDedupe when appPath is absent', async () => {
    await hooks.onInstall!({ skillName: 'online-appointments' });
    expect(ensureViteResolveDedupe).not.toHaveBeenCalled();
  });
});
