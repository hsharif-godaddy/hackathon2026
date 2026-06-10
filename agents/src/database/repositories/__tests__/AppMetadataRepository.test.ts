import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AppMetadataRepository } from '../AppMetadataRepository.js';
import { initializeTestDatabase } from '../../schema.js';
import * as connection from '../../connection.js';
import type { AppMetadata } from '@airo/shared';

vi.mock('../../connection.js');

// Logging to no-ops so tests don't emit noise.
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: vi.fn().mockReturnValue({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis(),
    }),
  },
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('AppMetadataRepository', () => {
  let db: Database.Database;
  let repo: AppMetadataRepository;
  const appId = 'abcde12345';

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);
    vi.mocked(connection.getDatabase).mockReturnValue(db);
    repo = new AppMetadataRepository();
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it('returns an empty object for an app with no metadata', () => {
    expect(repo.get(appId)).toEqual({});
  });

  it('merge() creates a row and returns the stored object', () => {
    const result = repo.merge(appId, { tag: 'alpha' });
    expect(result).toEqual({ tag: 'alpha' });
    expect(repo.get(appId)).toEqual({ tag: 'alpha' });
  });

  it('merge() shallow-merges into existing metadata (last-writer-wins)', () => {
    repo.merge(appId, { tag: 'alpha' });
    const result = repo.merge(appId, { ref: { id: 'one', kind: 'x' } });
    expect(result).toEqual({
      tag: 'alpha',
      ref: { id: 'one', kind: 'x' },
    });
  });

  it('merge() overwrites a key on repeat writes', () => {
    repo.merge(appId, { ref: { id: 'a' } });
    const result = repo.merge(appId, { ref: { id: 'b' } });
    expect(result.ref).toEqual({ id: 'b' });
  });

  it('isolates metadata per app', () => {
    repo.merge(appId, { tag: 'alpha' });
    expect(repo.get('zzzzz99999')).toEqual({});
  });

  it('returns {} and does not throw when the stored metadata is corrupt JSON', () => {
    db.prepare(`INSERT INTO app_metadata (app_id, metadata) VALUES (?, ?)`).run(appId, '{not valid json');
    expect(() => repo.get(appId)).not.toThrow();
    expect(repo.get(appId)).toEqual({});
  });

  it('persists and returns arbitrary ad-hoc keys', () => {
    repo.merge(appId, { _internalFlag: true, experimentId: 'exp-42' } as Partial<AppMetadata>);
    expect(repo.get(appId)).toEqual({ _internalFlag: true, experimentId: 'exp-42' });
  });
});
