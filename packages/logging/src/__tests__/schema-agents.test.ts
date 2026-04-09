import { describe, it, expect } from 'vitest';
import { createTestLogger } from '../test/index.js';

describe('agents schema - production JSON format', () => {
  it('should produce correct JSON structure for info event', () => {
    const { logger, destination } = createTestLogger({
      schema: 'agents',
      context: {
        appId: 'test-app-123',
        requestId: 'req-456',
      },
    });

    logger.info('app.create.begin', { name: 'my-app', templateVersion: 'v8' });

    const events = destination.getEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;
    // Required fields
    expect(event).toHaveProperty('level', 'info');
    expect(event).toHaveProperty('event', 'app.create.begin');
    expect(event).toHaveProperty('message');
    expect(typeof event.time).toBe('string'); // Pino uses 'time' in JSON

    // appId should be transformed to app_id
    expect(event).toHaveProperty('app_id', 'test-app-123');
    expect(event).not.toHaveProperty('appId');

    // Context fields
    expect(event).toHaveProperty('component', 'airo-agents');
    expect(event).toHaveProperty('service.name', 'airo-agent');

    // Data preserved
    expect(event).toHaveProperty('data');
    expect((event.data as Record<string, unknown>).name).toBe('my-app');
    expect((event.data as Record<string, unknown>).templateVersion).toBe('v8');
  });

  it('should sanitize sensitive data', () => {
    const { logger, destination } = createTestLogger({ schema: 'agents' });

    logger.info('auth.check', { password: 'secret123', token: 'abc', userId: 'user1' });

    const event = destination.getEvents()[0]!;
    const data = event.data as Record<string, unknown>;
    expect(data.password).toBe('[REDACTED]');
    expect(data.token).toBe('[REDACTED]');
    expect(data.userId).toBe('user1');
  });

  it('should NOT redact token usage fields', () => {
    const { logger, destination } = createTestLogger({ schema: 'agents' });

    logger.info('llm.response', {
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      cacheReadTokens: 50,
    });

    const event = destination.getEvents()[0]!;
    const data = event.data as Record<string, unknown>;
    expect(data.promptTokens).toBe(100);
    expect(data.completionTokens).toBe(200);
    expect(data.totalTokens).toBe(300);
    expect(data.cacheReadTokens).toBe(50);
  });

  it('should include duration, tags, meta, error when provided', () => {
    const { logger, destination } = createTestLogger({ schema: 'agents' });

    logger.error('app.create.failure', { name: 'my-app' }, {
      duration: 1234,
      tags: ['creation', 'quick-start'],
      meta: { region: 'us-east-1' },
      error: { name: 'Error', message: 'Something failed', stack: 'Error: ...' },
    });

    const event = destination.getEvents()[0]!;
    expect(event.level).toBe('error');
    expect(event.duration).toBe(1234);
    expect(event.tags).toEqual(['creation', 'quick-start']);
    expect(event.meta).toEqual({ region: 'us-east-1' });
    expect(event.error).toEqual({
      name: 'Error',
      message: 'Something failed',
      stack: 'Error: ...',
    });
  });

  it('should recursively transform appId in nested data', () => {
    const { logger, destination } = createTestLogger({ schema: 'agents' });

    logger.info('test.event', { nested: { appId: 'nested-app' } });

    const event = destination.getEvents()[0]!;
    const data = event.data as Record<string, unknown>;
    const nested = data.nested as Record<string, unknown>;
    expect(nested).toHaveProperty('app_id', 'nested-app');
    expect(nested).not.toHaveProperty('appId');
  });
});
