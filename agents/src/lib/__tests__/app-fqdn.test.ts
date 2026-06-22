import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initializeTestDatabase } from '../../database/schema.js';
import * as connection from '../../database/connection.js';
import { AppMetadataRepository } from '../../database/repositories/AppMetadataRepository.js';
import { persistAppFqdn, readAppFqdn } from '../app-fqdn.js';

vi.mock('../../database/connection.js');

vi.mock('../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
    }),
  },
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('app-fqdn', () => {
  let db: Database.Database;
  const appId = 'abcde12345';

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);
    vi.mocked(connection.getDatabase).mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  describe('persistAppFqdn', () => {
    it('persists fqdn when present', () => {
      persistAppFqdn(appId, { fqdn: 'studiosketch.com' });
      expect(new AppMetadataRepository().get(appId)).toEqual({ fqdn: 'studiosketch.com' });
    });

    it('does not write when fqdn is absent', () => {
      persistAppFqdn(appId, { other: 'x' });
      expect(new AppMetadataRepository().get(appId)).toEqual({});
    });

    it('does not write when appId is missing', () => {
      persistAppFqdn(undefined, { fqdn: 'studiosketch.com' });
      expect(new AppMetadataRepository().get(appId)).toEqual({});
    });

    it('skips the write when the stored value is unchanged', () => {
      persistAppFqdn(appId, { fqdn: 'studiosketch.com' });
      const mergeSpy = vi.spyOn(AppMetadataRepository.prototype, 'merge');
      persistAppFqdn(appId, { fqdn: 'studiosketch.com' });
      expect(mergeSpy).not.toHaveBeenCalled();
    });

    it('does not throw when the merge fails', () => {
      vi.spyOn(AppMetadataRepository.prototype, 'merge').mockImplementation(() => {
        throw new Error('write failed');
      });
      expect(() => persistAppFqdn(appId, { fqdn: 'studiosketch.com' })).not.toThrow();
    });
  });

  describe('readAppFqdn', () => {
    it('returns the persisted value', () => {
      new AppMetadataRepository().merge(appId, { fqdn: 'studiosketch.com' });
      expect(readAppFqdn(appId)).toBe('studiosketch.com');
    });

    it('falls back to the per-turn context metadata when nothing persisted', () => {
      expect(readAppFqdn(appId, { metadata: { fqdn: 'live.com' } })).toBe('live.com');
    });

    it('prefers the persisted value over the per-turn fallback', () => {
      new AppMetadataRepository().merge(appId, { fqdn: 'persisted.com' });
      expect(readAppFqdn(appId, { metadata: { fqdn: 'live.com' } })).toBe('persisted.com');
    });

    it('returns undefined when neither exists', () => {
      expect(readAppFqdn(appId)).toBeUndefined();
    });
  });
});
