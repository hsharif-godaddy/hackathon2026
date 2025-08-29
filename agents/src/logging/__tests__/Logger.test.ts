import { describe, it, expect, beforeEach } from 'vitest';
import { Logger, log, createTimer } from '../index.js';
import { TestHandler } from '../handlers/TestHandler.js';
import { LoggingPresets } from '../config.js';

describe('Logger', () => {
  let testHandler: TestHandler;
  
  beforeEach(() => {
    testHandler = new TestHandler();
    Logger.configure({
      ...LoggingPresets.test(),
      handlers: [testHandler]
    });
  });

  it('should create logger instance', () => {
    const logger = Logger.create();
    expect(logger).toBeDefined();
  });

  it('should log basic events', () => {
    const logger = Logger.create();
    
    logger.info('app.started', { port: 4000 });
    logger.debug('agent.tool.called', { toolName: 'file-edit' });
    
    const events = testHandler.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('app.started');
    expect(events[0].level).toBe('info');
    expect(events[1].event).toBe('agent.tool.called');
  });

  it('should create child logger with context', () => {
    const logger = Logger.create();
    const childLogger = logger.child({ appId: 'test-app' });
    
    childLogger.info('app.created', { name: 'Test App' });
    
    const events = testHandler.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].appId).toBe('test-app');
  });

  it('should respect log levels', () => {
    // Configure with warn level
    Logger.configure({
      level: 'warn',
      handlers: [testHandler]
    });
    
    const logger = Logger.create();
    
    logger.debug('test.debug');
    logger.info('test.info');
    logger.warn('test.warn');
    logger.error('test.error');
    
    const events = testHandler.getEvents();
    expect(events).toHaveLength(2); // Only warn and error should be logged
    expect(events[0].level).toBe('warn');
    expect(events[1].level).toBe('error');
  });

  it('should filter by domain', () => {
    Logger.configure({
      level: 'debug',
      handlers: [testHandler],
      enabledDomains: ['app']
    });
    
    const logger = Logger.create();
    
    logger.info('app.started');
    logger.info('agent.executed');
    logger.info('file.read');
    
    const events = testHandler.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('app.started');
  });

  it('should handle performance timing', () => {
    const logger = Logger.create();
    
    const timer = log.timer(logger, 'operation.completed');
    // Simulate some work
    setTimeout(() => {
      timer.end({ result: 'success' });
      
      const events = testHandler.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].event).toBe('operation.completed');
      expect(events[0].duration).toBeGreaterThan(0);
    }, 10);
  });

  it('should handle errors properly', () => {
    const logger = Logger.create();
    const error = new Error('Test error');
    
    log.error(logger, 'test.error', error, { context: 'test' });
    
    const events = testHandler.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].level).toBe('error');
    expect(events[0].data?.error?.name).toBe('Error');
    expect(events[0].data?.error?.message).toBe('Test error');
  });

  it('should provide test assertions', () => {
    const logger = Logger.create();
    const assertions = testHandler.createAssertions();
    
    logger.info('app.created', { name: 'Test' });
    logger.error('file.not.found', { path: '/missing' });
    
    expect(() => assertions.hasEventType('app.created')).not.toThrow();
    expect(() => assertions.hasErrorEvent()).not.toThrow();
    expect(() => assertions.eventCount(2)).not.toThrow();
    expect(() => assertions.domainEventCount('app', 1)).not.toThrow();
    expect(() => assertions.hasNoErrors()).toThrow();
  });

  it('should sanitize sensitive data', async () => {
    const logger = Logger.create();
    
    logger.info('api.request', {
      url: '/api/login',
      headers: {
        authorization: 'Bearer secret-token',
        'x-api-key': 'api-key-123'
      },
      body: {
        password: 'user-password',
        email: 'user@example.com'
      }
    });
    
    const events = testHandler.getEvents();
    expect(events).toHaveLength(1);
    
    // Sensitive data should be redacted
    const eventData = events[0].data;
    expect(eventData?.headers?.authorization).toBe('[REDACTED]');
    expect(eventData?.headers?.['x-api-key']).toBe('[REDACTED]');
    expect(eventData?.body?.password).toBe('[REDACTED]');
    expect(eventData?.body?.email).toBe('user@example.com'); // Email is not sensitive
  });
});