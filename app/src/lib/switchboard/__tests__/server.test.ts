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
import { checkSwitchboardFlag, checkSwitchboardObject, checkSwitchboardValue } from '@/lib/switchboard/server';

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

  describe('checkSwitchboardObject', () => {
    it('returns the object value from the tree', async function returnsObjectFromSetting() {
      const cfg = { issue: false, feedback: { enabled: true, maxRating: 7 } };
      getSwitchboardConfig.mockResolvedValue({ 'some-flag': cfg });

      await expect(checkSwitchboardObject('some-flag', req)).resolves.toEqual(cfg);
      expect(getSwitchboardConfig).toHaveBeenCalledWith(req);
    });

    it('returns null when the key is missing', async function returnsNullWhenMissing() {
      getSwitchboardConfig.mockResolvedValue({});
      await expect(checkSwitchboardObject('x', req)).resolves.toBeNull();
    });

    it('returns null for non-object values (string / boolean / number / array)', async function returnsNullWhenWrongType() {
      getSwitchboardConfig.mockResolvedValue({ x: 'str' });
      await expect(checkSwitchboardObject('x', req)).resolves.toBeNull();
      getSwitchboardConfig.mockResolvedValue({ x: true });
      await expect(checkSwitchboardObject('x', req)).resolves.toBeNull();
      getSwitchboardConfig.mockResolvedValue({ x: 7 });
      await expect(checkSwitchboardObject('x', req)).resolves.toBeNull();
      getSwitchboardConfig.mockResolvedValue({ x: [1, 2] });
      await expect(checkSwitchboardObject('x', req)).resolves.toBeNull();
    });

    it('warns on present-but-wrong-type (misconfig discoverability), with actualType', async function warnsOnTypeMismatch() {
      getSwitchboardConfig.mockResolvedValue({ x: 'str' });
      await checkSwitchboardObject('x', req);
      expect(logger.warn).toHaveBeenCalledWith(
        'switchboard.server.object-type-mismatch',
        expect.objectContaining({ featureName: 'x', actualType: 'string' }),
      );
      vi.clearAllMocks();
      getSwitchboardConfig.mockResolvedValue({ x: [1, 2] });
      await checkSwitchboardObject('x', req);
      expect(logger.warn).toHaveBeenCalledWith(
        'switchboard.server.object-type-mismatch',
        expect.objectContaining({ featureName: 'x', actualType: 'array' }),
      );
    });

    it('does NOT warn when the setting is absent (expected default path)', async function quietWhenAbsent() {
      getSwitchboardConfig.mockResolvedValue({});
      await checkSwitchboardObject('x', req);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('throws and logs when the tree lookup fails', async function throwsOnError() {
      getSwitchboardConfig.mockRejectedValue(new Error('boom'));
      await expect(checkSwitchboardObject('x', req)).rejects.toThrow('boom');
      expect(logger.error).toHaveBeenCalledWith(
        'switchboard.server.lookup-error',
        expect.objectContaining({ featureName: 'x', error: 'boom' }),
      );
    });

    it('throws when the plugin returns no tree', async function throwsOnNullTree() {
      getSwitchboardConfig.mockResolvedValue(null);
      await expect(checkSwitchboardObject('x', req)).rejects.toThrow(
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
