import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-context', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const getSwitchboardConfig = vi.fn();
vi.mock('../../../../gasket', () => ({
  default: {
    actions: {
      getSwitchboardConfig: (...args: unknown[]) => getSwitchboardConfig(...args),
    },
  },
}));

import { logger } from '@/lib/request-context';
import { checkSwitchboardFlag, checkSwitchboardValue } from '@/lib/switchboard/server';

const req = { headers: new Headers() };

describe('switchboard server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('checkSwitchboardValue', () => {
    it('returns string value from the tree', async function returnsStringFromSetting() {
      getSwitchboardConfig.mockResolvedValue({ 'some-flag': 'my-model' });

      await expect(checkSwitchboardValue('some-flag', req)).resolves.toBe('my-model');
      expect(getSwitchboardConfig).toHaveBeenCalledWith(req);
    });

    it('returns null when the key is missing', async function returnsNullWhenMissing() {
      getSwitchboardConfig.mockResolvedValue({});
      await expect(checkSwitchboardValue('x', req)).resolves.toBeNull();
    });

    it('returns null when the value is not a string', async function returnsNullWhenWrongType() {
      getSwitchboardConfig.mockResolvedValue({ x: true });
      await expect(checkSwitchboardValue('x', req)).resolves.toBeNull();
    });

    it('throws and logs when the tree lookup fails', async function throwsOnError() {
      getSwitchboardConfig.mockRejectedValue(new Error('boom'));
      await expect(checkSwitchboardValue('x', req)).rejects.toThrow('boom');
      expect(logger.error).toHaveBeenCalledWith(
        'switchboard.server.lookup-error',
        expect.objectContaining({ featureName: 'x', error: 'boom' }),
      );
    });

    it('throws when the plugin returns no tree', async function throwsOnNullTree() {
      getSwitchboardConfig.mockResolvedValue(null);
      await expect(checkSwitchboardValue('x', req)).rejects.toThrow(
        'gasket-plugin-switchboard returned no tree',
      );
    });

  });

  describe('checkSwitchboardFlag', () => {
    it('returns boolean from the tree', async function returnsBooleanFromSetting() {
      getSwitchboardConfig.mockResolvedValue({ 'some-flag': true });
      await expect(checkSwitchboardFlag('some-flag', req)).resolves.toBe(true);
    });

    it('returns false when the key is missing', async function returnsFalseWhenMissing() {
      getSwitchboardConfig.mockResolvedValue({});
      await expect(checkSwitchboardFlag('x', req)).resolves.toBe(false);
    });

    it('returns false when the value is not a boolean', async function returnsFalseWhenWrongType() {
      getSwitchboardConfig.mockResolvedValue({ x: 'string-value' });
      await expect(checkSwitchboardFlag('x', req)).resolves.toBe(false);
    });

    it('throws and logs when the tree lookup fails (paywall fail-closed contract)', async function throwsOnError() {
      getSwitchboardConfig.mockRejectedValue(new Error('boom'));
      await expect(checkSwitchboardFlag('x', req)).rejects.toThrow('boom');
      expect(logger.error).toHaveBeenCalledWith(
        'switchboard.server.lookup-error',
        expect.objectContaining({ featureName: 'x', error: 'boom' }),
      );
    });

    it('throws when the plugin returns no tree', async function throwsOnNullTree() {
      getSwitchboardConfig.mockResolvedValue(null);
      await expect(checkSwitchboardFlag('x', req)).rejects.toThrow(
        'gasket-plugin-switchboard returned no tree',
      );
    });

  });
});
