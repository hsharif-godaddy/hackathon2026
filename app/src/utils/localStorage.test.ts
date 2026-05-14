/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { safeGetItem, safeSetItem } from './localStorage';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/request-context', () => ({
  logger: mockLogger,
}));

describe('localStorage utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('safeGetItem', () => {
    it('returns the stored value', () => {
      localStorage.setItem('key', 'value');

      expect(safeGetItem('key')).toBe('value');
    });

    it('returns null when key does not exist', () => {
      expect(safeGetItem('missing')).toBeNull();
    });

    it('returns null and logs a warning when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('Access denied', 'SecurityError');
      });

      const result = safeGetItem('key');

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith('localStorage.getItem.failed', {
        key: 'key',
        error: 'SecurityError: Access denied',
      });
    });

    it('uses String(error) when a non-Error value is thrown', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw 'quota exceeded';
      });

      safeGetItem('key');

      expect(mockLogger.warn).toHaveBeenCalledWith('localStorage.getItem.failed', {
        key: 'key',
        error: 'quota exceeded',
      });
    });

    it('returns null when window is undefined (SSR)', () => {
      vi.stubGlobal('window', undefined);

      expect(safeGetItem('key')).toBeNull();
      expect(mockLogger.warn).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  describe('safeSetItem', () => {
    it('stores the value', () => {
      safeSetItem('key', 'value');

      expect(localStorage.getItem('key')).toBe('value');
    });

    it('logs a warning when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      });

      safeSetItem('key', 'value');

      expect(mockLogger.warn).toHaveBeenCalledWith('localStorage.setItem.failed', {
        key: 'key',
        error: 'QuotaExceededError: QuotaExceededError',
      });
    });

    it('does not throw when localStorage throws', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      });

      expect(() => safeSetItem('key', 'value')).not.toThrow();
    });

    it('uses String(error) when a non-Error value is thrown', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw 'storage full';
      });

      safeSetItem('key', 'value');

      expect(mockLogger.warn).toHaveBeenCalledWith('localStorage.setItem.failed', {
        key: 'key',
        error: 'storage full',
      });
    });

    it('does nothing when window is undefined (SSR)', () => {
      vi.stubGlobal('window', undefined);

      expect(() => safeSetItem('key', 'value')).not.toThrow();
      expect(mockLogger.warn).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });
});
