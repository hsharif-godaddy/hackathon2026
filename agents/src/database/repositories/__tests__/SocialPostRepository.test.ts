import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SocialPostRepository } from '../SocialPostRepository.js';
import { getDatabase } from '../../connection.js';
import { PostState } from '../../../types/social.js';

vi.mock('../../connection.js');
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('SocialPostRepository.update payload', function socialPostUpdatePayloadTests() {
  let mockStatement: { run: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; all: ReturnType<typeof vi.fn> };
  let mockDb: { prepare: ReturnType<typeof vi.fn> };

  beforeEach(function setup() {
    const row = {
      id: 'post-1', app_id: 'app1234567', association_id: null, platform: null, state: 'DRAFT',
      payload: '{"message":"new"}', external_response: null, external_id: null,
      scheduled_at: null, completed_at: null, campaign_id: 'camp_x',
      created_at: '2026-06-18T00:00:00Z', updated_at: '2026-06-18T00:00:00Z',
    };
    mockStatement = {
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
      get: vi.fn().mockReturnValue(row),
      all: vi.fn().mockReturnValue([]),
    };
    mockDb = { prepare: vi.fn().mockReturnValue(mockStatement) };
    vi.mocked(getDatabase).mockReturnValue(mockDb as never);
  });

  it('writes payload = ? with JSON-stringified payload in the UPDATE', function writesPayload() {
    const repo = new SocialPostRepository();
    repo.update('post-1', { payload: { message: 'new', hashtags: ['x'] } });

    const updateCall = mockDb.prepare.mock.calls.find(([sql]: [string]) => sql.includes('UPDATE social_posts SET'));
    expect(updateCall?.[0]).toContain('payload = ?');
    expect(mockStatement.run).toHaveBeenCalledWith(JSON.stringify({ message: 'new', hashtags: ['x'] }), 'post-1');
  });

  it('throws "No fields to update" when nothing is provided', function throwsWhenEmpty() {
    const repo = new SocialPostRepository();
    expect(() => repo.update('post-1', {})).toThrow('No fields to update');
  });
});

describe('SocialPostRepository state validation', function socialPostStateValidationTests() {
  let mockStatement: { run: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; all: ReturnType<typeof vi.fn> };
  let mockDb: { prepare: ReturnType<typeof vi.fn> };

  beforeEach(function setup() {
    const row = {
      id: 'post-1', app_id: 'app1234567', association_id: null, platform: 'facebook', state: 'DRAFT',
      payload: '{"message":"x"}', external_response: null, external_id: null,
      scheduled_at: null, completed_at: null, campaign_id: 'camp_x',
      created_at: '2026-06-18T00:00:00Z', updated_at: '2026-06-18T00:00:00Z',
    };
    mockStatement = {
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 1 }),
      get: vi.fn().mockReturnValue(row),
      all: vi.fn().mockReturnValue([]),
    };
    mockDb = { prepare: vi.fn().mockReturnValue(mockStatement) };
    vi.mocked(getDatabase).mockReturnValue(mockDb as never);
  });

  it('create() rejects an out-of-range state before inserting', function createRejectsBadState() {
    const repo = new SocialPostRepository();
    expect(() =>
      repo.create({ appId: 'app1234567', platform: null, state: 'BOGUS' as PostState, payload: { message: 'x' } }),
    ).toThrow(/Invalid social post state/);
    expect(mockStatement.run).not.toHaveBeenCalled();
  });

  it('update() rejects an out-of-range state', function updateRejectsBadState() {
    const repo = new SocialPostRepository();
    expect(() => repo.update('post-1', { state: 'NOPE' as PostState })).toThrow(/Invalid social post state/);
  });

  it('create() accepts a valid state and inserts', function createAcceptsValidState() {
    const repo = new SocialPostRepository();
    const post = repo.create({ appId: 'app1234567', platform: 'facebook', state: PostState.DRAFT, payload: { message: 'x' } });
    expect(post).toBeTruthy();
    expect(mockStatement.run).toHaveBeenCalled();
  });
});

describe('SocialPostRepository.delete contract', function socialPostDeleteTests() {
  let mockStatement: { run: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; all: ReturnType<typeof vi.fn> };
  let mockDb: { prepare: ReturnType<typeof vi.fn> };

  beforeEach(function setup() {
    mockStatement = {
      run: vi.fn().mockReturnValue({ changes: 1, lastInsertRowid: 0 }),
      get: vi.fn(),
      all: vi.fn().mockReturnValue([]),
    };
    mockDb = { prepare: vi.fn().mockReturnValue(mockStatement) };
    vi.mocked(getDatabase).mockReturnValue(mockDb as never);
  });

  it('returns true when a row is deleted (changes > 0)', function deletesRow() {
    const repo = new SocialPostRepository();
    expect(repo.delete('post-1')).toBe(true);
  });

  it('returns false when no row matches (changes === 0) without throwing', function noRowDeleted() {
    mockStatement.run.mockReturnValue({ changes: 0, lastInsertRowid: 0 });
    const repo = new SocialPostRepository();
    expect(repo.delete('post-missing')).toBe(false);
  });

  // Guards the cascade contract: deleteSocialDraft runs in a transaction and relies on
  // delete() RE-THROWING (not returning false) so a mid-cascade DB error rolls back rather
  // than reporting a false success on an orphaned row. A revert to `return false` fails here.
  it('re-throws on a genuine DB error instead of swallowing it as false', function rethrowsOnDbError() {
    mockStatement.run.mockImplementation(function throwDbError(): never { throw new Error('SQLITE_IOERR'); });
    const repo = new SocialPostRepository();
    expect(() => repo.delete('post-1')).toThrow('SQLITE_IOERR');
  });
});
