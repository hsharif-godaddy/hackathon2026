import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';

const { mockGetLastMessageTimestamp, mockGetStats, mockValidateAll } = vi.hoisted(() => ({
  mockGetLastMessageTimestamp: vi.fn().mockResolvedValue('2024-01-01T00:00:00.000Z'),
  mockGetStats: vi.fn().mockReturnValue({
    totalAgents: 5,
    activeAgents: 3,
  }),
  mockValidateAll: vi.fn().mockResolvedValue({
    valid: ['agent1', 'agent2'],
    invalid: [],
  }),
}));

vi.mock('../../../memory/adapters/index.js', () => ({
  getConversationTokenStore: vi.fn(() => ({
    getLastMessageTimestamp: mockGetLastMessageTimestamp,
  })),
}));

vi.mock('../../../registry/index.js', () => ({
  AgentRegistry: {
    getInstance: vi.fn(() => ({
      getStats: mockGetStats,
      validateAll: mockValidateAll,
    })),
  },
}));

import { healthRouter } from '../health.js';

describe('Health Router', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/health', healthRouter);
    app.use('/airo/health', healthRouter);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /health', () => {
    it('should return health status with basic fields (no detailed stats by default)', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('memory');
      expect(response.body).toHaveProperty('registry');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('last_message_at');

      // Should NOT include detailed stats by default
      expect(response.body).not.toHaveProperty('heapStats');
      expect(response.body).not.toHaveProperty('heapSpaces');
    });

    it('should NOT include detailed stats even with detailed=true query param', async () => {
      const response = await request(app).get('/health?detailed=true');

      expect(response.status).toBe(200);
      // Detailed stats should no longer be available on /health endpoint
      expect(response.body).not.toHaveProperty('heapStats');
      expect(response.body).not.toHaveProperty('heapSpaces');

      // Should still have basic health fields
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('memory');
    });

    it('should NOT include detailed stats when detailed=false', async () => {
      const response = await request(app).get('/health?detailed=false');

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('heapStats');
      expect(response.body).not.toHaveProperty('heapSpaces');
    });

    it('should return process memory usage', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.memory).toBeDefined();
      expect(response.body.memory).toHaveProperty('rss');
      expect(response.body.memory).toHaveProperty('heapTotal');
      expect(response.body.memory).toHaveProperty('heapUsed');
      expect(response.body.memory).toHaveProperty('external');
      expect(response.body.memory).toHaveProperty('arrayBuffers');

      // Verify all values are numbers
      expect(typeof response.body.memory.rss).toBe('number');
      expect(typeof response.body.memory.heapTotal).toBe('number');
      expect(typeof response.body.memory.heapUsed).toBe('number');
    });


    it('should return healthy status when all systems operational', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
    });

    it('should return degraded status when database query fails', async () => {
      mockGetLastMessageTimestamp.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('degraded');

      // Reset mock for subsequent tests
      mockGetLastMessageTimestamp.mockResolvedValue('2024-01-01T00:00:00.000Z');
    });

    it('should return numeric uptime', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.uptime).toBeDefined();
      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return ISO timestamp', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.timestamp).toBeDefined();
      expect(typeof response.body.timestamp).toBe('string');

      // Verify it's a valid ISO 8601 timestamp
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp.toISOString()).toBe(response.body.timestamp);
    });
  });

  describe('GET /airo/health', () => {
    it('should return health status at the Nomad probe path', async () => {
      const response = await request(app).get('/airo/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('memory');
    });
  });

  describe('GET /health/agents', () => {
    it('should return agent validation status', async () => {
      mockValidateAll.mockResolvedValueOnce({
        valid: ['agent1', 'agent2'],
        invalid: [],
      });

      const response = await request(app).get('/health/agents');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body.agents).toHaveProperty('valid');
      expect(response.body.agents).toHaveProperty('invalid');
      expect(response.body.agents).toHaveProperty('total', 2);
    });

    it('should return degraded status when agents are invalid', async () => {
      mockValidateAll.mockResolvedValueOnce({
        valid: ['agent1'],
        invalid: ['agent2'],
      });

      const response = await request(app).get('/health/agents');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('degraded');
      expect(response.body.agents.invalid.length).toBe(1);
    });
  });
});
