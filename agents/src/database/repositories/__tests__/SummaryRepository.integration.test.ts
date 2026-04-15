import { describe, it, expect, beforeEach } from 'vitest';
import { getDatabase } from '../../connection.js';
import { initializeSchema } from '../../schema.js';
import { SummaryRepository } from '../SummaryRepository.js';
import type { SummarizationResult } from '../../../services/summarization/SummarizationStrategy.js';

describe('repositories', function repositoriesTests() {
  describe('#SummaryRepository', function summaryRepositoryTests() {
    let db: ReturnType<typeof getDatabase>;
    let summaryRepo: SummaryRepository;
    const testAppId = 'test-app';

    beforeEach(function setup() {
      db = getDatabase();
      initializeSchema(db);
      
      // Clean up any existing summaries for test app
      db.prepare('DELETE FROM conversation_summaries WHERE app_id = ?').run(testAppId);
      
      // Create a test app to satisfy foreign key constraint (or update if exists)
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO apps (id, name, path, port, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(testAppId, 'Test App', '/tmp/test-app', 5000, 'created', now, now);
      
      summaryRepo = new SummaryRepository();
    });

    it('should create and retrieve summary', async function create() {
      const summary: SummarizationResult = {
        summaryText: 'Test summary',
        summaryTokenCount: 50,
        modelUsed: 'claude-sonnet-4-6',
        messageRange: { startId: 'msg1', endId: 'msg2' },
        messageCount: 10,
        originalTokenCount: 500,
      };

      const created = await summaryRepo.create(summary, testAppId);

      expect(created.id).toBeTypeOf('string');
      expect(created.appId).toBe(testAppId);
      expect(created.summaryText).toBe('Test summary');
      expect(created.messageRangeStart).toBe('msg1');
      expect(created.messageRangeEnd).toBe('msg2');
      expect(created.messageCount).toBe(10);
      expect(created.originalTokenCount).toBe(500);
      expect(created.summaryTokenCount).toBe(50);
      expect(created.modelUsed).toBe('claude-sonnet-4-6');
    });

    it('should find summaries by app ID', async function findByAppId() {
      const summary1: SummarizationResult = {
        summaryText: 'First summary',
        summaryTokenCount: 30,
        modelUsed: 'claude-sonnet-4-6',
        messageRange: { startId: 'msg1', endId: 'msg5' },
        messageCount: 5,
        originalTokenCount: 300,
      };

      const summary2: SummarizationResult = {
        summaryText: 'Second summary',
        summaryTokenCount: 40,
        modelUsed: 'claude-sonnet-4-6',
        messageRange: { startId: 'msg6', endId: 'msg10' },
        messageCount: 5,
        originalTokenCount: 400,
      };

      await summaryRepo.create(summary1, testAppId);
      await summaryRepo.create(summary2, testAppId);

      const summaries = await summaryRepo.findByAppId(testAppId);

      expect(summaries).toHaveLength(2);
      expect(summaries[0].summaryText).toBe('First summary');
      expect(summaries[1].summaryText).toBe('Second summary');
    });

    it('should find summary by message range', async function findByMessageRange() {
      const summary: SummarizationResult = {
        summaryText: 'Range summary',
        summaryTokenCount: 25,
        modelUsed: 'claude-sonnet-4-6',
        messageRange: { startId: 'msg1', endId: 'msg3' },
        messageCount: 3,
        originalTokenCount: 250,
      };

      await summaryRepo.create(summary, testAppId);

      const found = await summaryRepo.findByMessageRange('msg1', 'msg3');

      expect(found).not.toBeNull();
      expect(found?.summaryText).toBe('Range summary');
    });

    it('should find latest summary for app', async function findLatest() {
      const summary1: SummarizationResult = {
        summaryText: 'Old summary',
        summaryTokenCount: 20,
        modelUsed: 'claude-sonnet-4-6',
        messageRange: { startId: 'msg1', endId: 'msg2' },
        messageCount: 2,
        originalTokenCount: 200,
      };

      const summary2: SummarizationResult = {
        summaryText: 'New summary',
        summaryTokenCount: 30,
        modelUsed: 'claude-sonnet-4-6',
        messageRange: { startId: 'msg3', endId: 'msg4' },
        messageCount: 2,
        originalTokenCount: 300,
      };

      await summaryRepo.create(summary1, testAppId);
      await summaryRepo.create(summary2, testAppId);

      const latest = await summaryRepo.findLatestForApp(testAppId);

      expect(latest).not.toBeNull();
      expect(latest?.summaryText).toBe('New summary');
    });

    it('should delete summaries by app ID', async function deleteByAppId() {
      const summary: SummarizationResult = {
        summaryText: 'To delete',
        summaryTokenCount: 15,
        modelUsed: 'claude-sonnet-4-6',
        messageRange: { startId: 'msg1', endId: 'msg2' },
        messageCount: 2,
        originalTokenCount: 150,
      };

      await summaryRepo.create(summary, testAppId);

      const before = await summaryRepo.findByAppId(testAppId);
      expect(before).toHaveLength(1);

      await summaryRepo.deleteByAppId(testAppId);

      const after = await summaryRepo.findByAppId(testAppId);
      expect(after).toHaveLength(0);
    });
  });
});

