/**
 * ShareTokenRepository Test Suite
 *
 * Comprehensive tests for the ShareTokenRepository class covering:
 * - Token creation with cryptographic randomness
 * - Token retrieval by appId and token value
 * - Token expiration tracking and cleanup
 * - First-use timestamp tracking
 * - Token deletion (manual and automatic)
 * - Database integrity and CASCADE deletes
 * - Error handling and edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ShareTokenRepository } from '../ShareTokenRepository.js';
import type { ShareToken } from '../../schema.js';

// Mock dependencies
vi.mock('../../connection.js');
vi.mock('../../../utils/share-token-generator.js');
vi.mock('../../../logging/index.js', () => ({
  Logger: {
    create: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('ShareTokenRepository', () => {
  let repository: ShareTokenRepository;
  let mockDb: any;
  let mockStatement: any;

  // Test data
  const testAppId = 'app-abc123';
  const testToken = 'test-token-12';
  const futureExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days from now
  const pastExpiry = Date.now() - 1000; // 1 second ago
  const testCreatedAt = '2024-01-01T10:00:00.000Z';

  const mockDbRow = {
    token: testToken,
    app_id: testAppId,
    expires_at: futureExpiry,
    purpose: 'user' as const,
    created_at: testCreatedAt,
    first_used_at: null,
  };

  const expectedToken: ShareToken = {
    token: testToken,
    appId: testAppId,
    expiresAt: futureExpiry,
    purpose: 'user',
    createdAt: new Date(testCreatedAt),
    firstUsedAt: null,
  };

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock database statement
    mockStatement = {
      get: vi.fn(),
      all: vi.fn(),
      run: vi.fn().mockReturnValue({ changes: 1 }),
    };

    // Mock database connection
    mockDb = {
      prepare: vi.fn().mockReturnValue(mockStatement),
    };

    // Mock getDatabase
    const { getDatabase } = await import('../../connection.js');
    vi.mocked(getDatabase).mockReturnValue(mockDb);

    // Mock generateShareToken
    const { generateShareToken } = await import('../../../utils/share-token-generator.js');
    vi.mocked(generateShareToken).mockReturnValue(testToken);

    // Create repository instance
    repository = new ShareTokenRepository();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with database connection', () => {
      expect(repository).toBeInstanceOf(ShareTokenRepository);
      expect(mockDb).toBeDefined();
    });
  });

  describe('create', () => {
    it('should create a new share token with generated token', () => {
      const result = repository.create({
        appId: testAppId,
        expiresIn: 604800, // 7 days in seconds
      });

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO share_tokens'),
      );
      expect(mockStatement.run).toHaveBeenCalledWith(
        testToken,
        testAppId,
        expect.any(Number),
        'user', // purpose defaults to 'user' when not specified
        expect.any(String),
      );

      expect(result).toMatchObject({
        token: testToken,
        appId: testAppId,
        purpose: 'user',
        firstUsedAt: null,
      });
      expect(result.expiresAt).toBeGreaterThan(Date.now());
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should calculate correct expiration timestamp', () => {
      const expiresIn = 3600; // 1 hour
      const beforeCreate = Date.now();

      const result = repository.create({
        appId: testAppId,
        expiresIn,
      });

      const afterCreate = Date.now();
      const expectedExpiry = beforeCreate + expiresIn * 1000;
      const maxExpiry = afterCreate + expiresIn * 1000;

      expect(result.expiresAt).toBeGreaterThanOrEqual(expectedExpiry);
      expect(result.expiresAt).toBeLessThanOrEqual(maxExpiry);
    });

    it('should create token with custom expiration duration', () => {
      const shortExpiry = 60; // 1 minute
      const result = repository.create({
        appId: testAppId,
        expiresIn: shortExpiry,
      });

      const expectedExpiry = Date.now() + shortExpiry * 1000;
      expect(result.expiresAt).toBeCloseTo(expectedExpiry, -3); // Within 1 second
    });

    it('should throw error when database insert fails', () => {
      mockStatement.run.mockImplementation(function () {
        throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed');
      });

      expect(() => {
        repository.create({
          appId: testAppId,
          expiresIn: 604800,
        });
      }).toThrow('SQLITE_CONSTRAINT');
    });

    it('should handle token collision by throwing error', () => {
      // First call succeeds
      mockStatement.run.mockReturnValueOnce({ changes: 1 });

      // Second call fails with collision
      mockStatement.run.mockImplementationOnce(function () {
        throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: share_tokens.token');
      });

      repository.create({ appId: testAppId, expiresIn: 604800 });

      expect(() => {
        repository.create({ appId: testAppId, expiresIn: 604800 });
      }).toThrow('UNIQUE constraint failed');
    });
  });

  describe('findByAppId', () => {
    it('should return all tokens for an app', () => {
      const row1 = { ...mockDbRow, token: 'token-1' };
      const row2 = { ...mockDbRow, token: 'token-2', expires_at: pastExpiry };

      mockStatement.all.mockReturnValue([row1, row2]);

      const result = repository.findByAppId(testAppId);

      expect(result).toHaveLength(2);
      expect(result[0].token).toBe('token-1');
      expect(result[1].token).toBe('token-2');
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE app_id = ?'),
      );
      expect(mockStatement.all).toHaveBeenCalledWith(testAppId);
    });

    it('should return tokens ordered by created_at DESC', () => {
      mockStatement.all.mockReturnValue([mockDbRow]);

      repository.findByAppId(testAppId);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
      );
    });

    it('should return empty array when app has no tokens', () => {
      mockStatement.all.mockReturnValue([]);

      const result = repository.findByAppId('nonexistent-app');

      expect(result).toEqual([]);
    });

    it('should include both expired and valid tokens', () => {
      const validToken = { ...mockDbRow, token: 'valid', expires_at: futureExpiry };
      const expiredToken = { ...mockDbRow, token: 'expired', expires_at: pastExpiry };

      mockStatement.all.mockReturnValue([validToken, expiredToken]);

      const result = repository.findByAppId(testAppId);

      expect(result).toHaveLength(2);
      expect(result.some(t => t.expiresAt > Date.now())).toBe(true);
      expect(result.some(t => t.expiresAt < Date.now())).toBe(true);
    });

    it('should map first_used_at correctly', () => {
      const usedRow = {
        ...mockDbRow,
        first_used_at: '2024-01-02T15:30:00.000Z',
      };

      mockStatement.all.mockReturnValue([usedRow]);

      const result = repository.findByAppId(testAppId);

      expect(result[0].firstUsedAt).toBeInstanceOf(Date);
      expect(result[0].firstUsedAt?.toISOString()).toBe('2024-01-02T15:30:00.000Z');
    });
  });

  describe('findByToken', () => {
    it('should return token when found', () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = repository.findByToken(testToken);

      expect(result).toEqual(expectedToken);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE token = ?'),
      );
      expect(mockStatement.get).toHaveBeenCalledWith(testToken);
    });

    it('should return null when token not found', () => {
      mockStatement.get.mockReturnValue(undefined);

      const result = repository.findByToken('nonexistent-token');

      expect(result).toBeNull();
    });

    it('should handle token with firstUsedAt set', () => {
      const usedRow = {
        ...mockDbRow,
        first_used_at: '2024-01-02T12:00:00.000Z',
      };
      mockStatement.get.mockReturnValue(usedRow);

      const result = repository.findByToken(testToken);

      expect(result?.firstUsedAt).toBeInstanceOf(Date);
      expect(result?.firstUsedAt?.toISOString()).toBe('2024-01-02T12:00:00.000Z');
    });

    it('should return expired token without filtering', () => {
      const expiredRow = { ...mockDbRow, expires_at: pastExpiry };
      mockStatement.get.mockReturnValue(expiredRow);

      const result = repository.findByToken(testToken);

      expect(result).not.toBeNull();
      expect(result?.expiresAt).toBeLessThan(Date.now());
    });
  });

  describe('markFirstUsed', () => {
    it('should mark token as first used when not already marked', () => {
      mockStatement.run.mockReturnValue({ changes: 1 });

      repository.markFirstUsed(testToken);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE share_tokens'),
      );
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('WHERE token = ? AND first_used_at IS NULL'),
      );
      expect(mockStatement.run).toHaveBeenCalledWith(
        expect.any(String), // timestamp
        testToken,
      );
    });

    it('should be idempotent (no changes when already marked)', () => {
      mockStatement.run.mockReturnValue({ changes: 0 });

      // Should not throw even if already marked
      expect(() => {
        repository.markFirstUsed(testToken);
      }).not.toThrow();
    });

    it('should not throw error when marking fails', () => {
      mockStatement.run.mockImplementation(function () {
        throw new Error('Database error');
      });

      // Should not throw - marking first use is not critical
      expect(() => {
        repository.markFirstUsed(testToken);
      }).not.toThrow();
    });

    it('should set timestamp to current time', () => {
      const beforeMark = Date.now();
      repository.markFirstUsed(testToken);
      const afterMark = Date.now();

      const callArgs = mockStatement.run.mock.calls[0];
      const timestamp = new Date(callArgs[0]).getTime();

      expect(timestamp).toBeGreaterThanOrEqual(beforeMark);
      expect(timestamp).toBeLessThanOrEqual(afterMark);
    });
  });

  describe('delete', () => {
    it('should delete token by token value', () => {
      mockStatement.run.mockReturnValue({ changes: 1 });

      repository.delete(testToken);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM share_tokens WHERE token = ?'),
      );
      expect(mockStatement.run).toHaveBeenCalledWith(testToken);
    });

    it('should not throw error when deleting non-existent token', () => {
      mockStatement.run.mockReturnValue({ changes: 0 });

      expect(() => {
        repository.delete('nonexistent-token');
      }).not.toThrow();
    });

    it('should throw error when database delete fails', () => {
      mockStatement.run.mockImplementation(function () {
        throw new Error('Database error');
      });

      expect(() => {
        repository.delete(testToken);
      }).toThrow('Database error');
    });
  });

  describe('deleteExpired', () => {
    it('should delete all expired tokens', () => {
      mockStatement.run.mockReturnValue({ changes: 5 });

      const result = repository.deleteExpired();

      expect(result).toBe(5);
      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM share_tokens WHERE expires_at < ?'),
      );
      expect(mockStatement.run).toHaveBeenCalledWith(expect.any(Number));
    });

    it('should return 0 when no expired tokens', () => {
      mockStatement.run.mockReturnValue({ changes: 0 });

      const result = repository.deleteExpired();

      expect(result).toBe(0);
    });

    it('should use current timestamp for expiry check', () => {
      const beforeCall = Date.now();
      repository.deleteExpired();
      const afterCall = Date.now();

      const callArg = mockStatement.run.mock.calls[0][0];

      expect(callArg).toBeGreaterThanOrEqual(beforeCall);
      expect(callArg).toBeLessThanOrEqual(afterCall);
    });

    it('should throw error when database delete fails', () => {
      mockStatement.run.mockImplementation(function () {
        throw new Error('Database error');
      });

      expect(() => {
        repository.deleteExpired();
      }).toThrow('Database error');
    });
  });

  describe('Data Mapping', () => {
    it('should correctly map snake_case columns to camelCase properties', () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = repository.findByToken(testToken);

      expect(result).toMatchObject({
        token: mockDbRow.token,
        appId: mockDbRow.app_id,
        expiresAt: mockDbRow.expires_at,
      });
    });

    it('should convert timestamp strings to Date objects', () => {
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = repository.findByToken(testToken);

      expect(result?.createdAt).toBeInstanceOf(Date);
      expect(result?.createdAt.toISOString()).toBe(testCreatedAt);
    });

    it('should handle null first_used_at', () => {
      mockStatement.get.mockReturnValue({ ...mockDbRow, first_used_at: null });

      const result = repository.findByToken(testToken);

      expect(result?.firstUsedAt).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long app IDs', () => {
      const longAppId = 'a'.repeat(100);
      repository.create({ appId: longAppId, expiresIn: 604800 });

      expect(mockStatement.run).toHaveBeenCalledWith(
        expect.any(String),
        longAppId,
        expect.any(Number),
        'user', // purpose
        expect.any(String),
      );
    });

    it('should handle tokens expiring at exact current time', () => {
      const now = Date.now();
      const tokenExpiringNow = {
        ...mockDbRow,
        expires_at: now,
      };

      mockStatement.all.mockReturnValue([tokenExpiringNow]);

      const result = repository.findByAppId(testAppId);

      // Token should be returned (caller must check expiration)
      expect(result).toHaveLength(1);
      expect(result[0].expiresAt).toBe(now);
    });

    it('should handle minimum expiration duration (1 second)', () => {
      const result = repository.create({
        appId: testAppId,
        expiresIn: 1,
      });

      const expectedExpiry = Date.now() + 1000;
      expect(result.expiresAt).toBeCloseTo(expectedExpiry, -2);
    });

    it('should handle maximum expiration duration (1 year)', () => {
      const oneYearInSeconds = 365 * 24 * 60 * 60;
      const result = repository.create({
        appId: testAppId,
        expiresIn: oneYearInSeconds,
      });

      const expectedExpiry = Date.now() + oneYearInSeconds * 1000;
      expect(result.expiresAt).toBeCloseTo(expectedExpiry, -5);
    });

    it('should handle empty app ID', () => {
      mockStatement.all.mockReturnValue([]);

      const result = repository.findByAppId('');

      expect(result).toEqual([]);
      expect(mockStatement.all).toHaveBeenCalledWith('');
    });
  });

  describe('CASCADE Delete Behavior', () => {
    it('should allow tokens to exist after app is deleted (if CASCADE not enforced)', () => {
      // This test documents that CASCADE delete is handled by schema
      // The repository itself doesn't enforce referential integrity
      mockStatement.get.mockReturnValue(mockDbRow);

      const result = repository.findByToken(testToken);

      expect(result).not.toBeNull();
      // In production, CASCADE DELETE in schema will handle cleanup
    });
  });

  describe('Concurrent Access', () => {
    it('should handle multiple tokens for same app', () => {
      const tokens = Array.from({ length: 10 }, (_, i) => ({
        ...mockDbRow,
        token: `token-${i}`,
      }));

      mockStatement.all.mockReturnValue(tokens);

      const result = repository.findByAppId(testAppId);

      expect(result).toHaveLength(10);
    });

    it('should handle marking first use on already-marked token gracefully', () => {
      mockStatement.run.mockReturnValue({ changes: 0 });

      // Should not throw
      repository.markFirstUsed(testToken);
      repository.markFirstUsed(testToken);
    });
  });

  describe('purpose handling', () => {
    it('passes provided purpose to the INSERT and returns it on the token', () => {
      const result = repository.create({
        appId: testAppId,
        expiresIn: 900,
        purpose: 'archive_snapshot',
      });

      expect(mockStatement.run).toHaveBeenCalledWith(
        testToken,
        testAppId,
        expect.any(Number),
        'archive_snapshot',
        expect.any(String),
      );
      expect(result.purpose).toBe('archive_snapshot');
    });

    it('defaults purpose to "user" when omitted', () => {
      const result = repository.create({ appId: testAppId, expiresIn: 604800 });

      expect(mockStatement.run).toHaveBeenCalledWith(
        testToken,
        testAppId,
        expect.any(Number),
        'user',
        expect.any(String),
      );
      expect(result.purpose).toBe('user');
    });

    it('findByAppId(appId, purpose) filters by purpose in the query', () => {
      mockStatement.all.mockReturnValue([
        { ...mockDbRow, purpose: 'archive_snapshot' },
      ]);

      repository.findByAppId(testAppId, 'archive_snapshot');

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.stringContaining('AND purpose = ?'),
      );
      expect(mockStatement.all).toHaveBeenCalledWith(testAppId, 'archive_snapshot');
    });

    it('findByAppId without a purpose returns all purposes', () => {
      mockStatement.all.mockReturnValue([
        { ...mockDbRow, purpose: 'user' },
        { ...mockDbRow, token: 'snap-token', purpose: 'archive_snapshot' },
      ]);

      const result = repository.findByAppId(testAppId);

      expect(mockDb.prepare).toHaveBeenCalledWith(
        expect.not.stringContaining('AND purpose = ?'),
      );
      expect(result.map(t => t.purpose).sort()).toEqual(['archive_snapshot', 'user']);
    });

    it('findByToken returns the row purpose', () => {
      mockStatement.get.mockReturnValue({ ...mockDbRow, purpose: 'archive_snapshot' });

      const result = repository.findByToken(testToken);

      expect(result?.purpose).toBe('archive_snapshot');
    });

    it('falls back to "user" purpose for legacy rows missing the column value', () => {
      // Backfill safety: rows persisted before the migration ran would deserialize
      // with purpose=null (or absent) at the row level. Repository must coerce
      // these to the column DEFAULT instead of leaking null up the stack.
      mockStatement.get.mockReturnValue({ ...mockDbRow, purpose: null });

      const result = repository.findByToken(testToken);

      expect(result?.purpose).toBe('user');
    });

    it('coerces unknown purpose values to "user" without leaking them up the stack', () => {
      // Defends against downgrade rollouts (a future schema knows 'foo', the
      // current binary doesn't) and manual DB corruption. Ship the safer 'user'
      // default to consumers rather than the unknown raw string.
      mockStatement.get.mockReturnValue({ ...mockDbRow, purpose: 'foo' });

      const result = repository.findByToken(testToken);

      expect(result?.purpose).toBe('user');
    });
  });
});
