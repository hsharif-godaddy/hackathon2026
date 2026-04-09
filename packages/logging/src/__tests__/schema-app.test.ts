import { describe, it, expect } from 'vitest';
import { createTestLogger } from '../test/index.js';

describe('app schema - production JSON format', () => {
  it('should produce correct JSON structure with customerId and trace fields', () => {
    const { logger, destination } = createTestLogger({
      schema: 'app',
      context: {
        customerId: 'cid-12345',
        'trace.id': '0af7651916cd43dd8448eb211c80319c',
        'span.id': 'b7ad6b7169203331',
        'transaction.id': 'b7ad6b7169203331',
      },
    });

    logger.info('agent-token.permissions-granted', {
      siteId: 'app-123',
      canPublish: true,
      canDownload: true,
    });

    const events = destination.getEvents();
    expect(events).toHaveLength(1);

    const event = events[0]!;
    expect(event).toHaveProperty('level', 'info');
    expect(event).toHaveProperty('event', 'agent-token.permissions-granted');
    expect(event).toHaveProperty('customerId', 'cid-12345');
    expect(event).toHaveProperty('trace.id', '0af7651916cd43dd8448eb211c80319c');
    expect(event).toHaveProperty('span.id', 'b7ad6b7169203331');
    expect(event).toHaveProperty('transaction.id', 'b7ad6b7169203331');

    const data = event.data as Record<string, unknown>;
    expect(data.siteId).toBe('app-123');
    expect(data.canPublish).toBe(true);
  });

  it('should include error details', () => {
    const { logger, destination } = createTestLogger({ schema: 'app' });

    logger.error('api.request.failed', { endpoint: '/sites' }, {
      error: { name: 'FetchError', message: 'Network timeout' },
      duration: 5000,
    });

    const event = destination.getEvents()[0]!;
    expect(event.level).toBe('error');
    expect(event.error).toEqual({ name: 'FetchError', message: 'Network timeout' });
    expect(event.duration).toBe(5000);
  });
});
