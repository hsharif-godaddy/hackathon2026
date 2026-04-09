import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { proxyFormatters } from '../schemas/proxy.js';

describe('proxy schema - production JSON format', () => {
  it('should output level as UPPERCASE', () => {
    const chunks: string[] = [];
    const dest = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });

    const logger = pino({
      level: 'debug',
      formatters: proxyFormatters(),
      timestamp: pino.stdTimeFunctions.isoTime,
    }, dest);

    logger.info({ msg: 'test message' }, 'test message');

    // Pino writes asynchronously to the destination
    // Force flush by ending the stream
    dest.end();

    expect(chunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(chunks[0]!);
    expect(parsed.level).toBe('INFO');
    expect(typeof parsed.time).toBe('string');
  });

  it('should preserve pid and hostname', () => {
    const chunks: string[] = [];
    const dest = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });

    const logger = pino({
      level: 'debug',
      formatters: proxyFormatters(),
      timestamp: pino.stdTimeFunctions.isoTime,
    }, dest);

    logger.info('proxy started');
    dest.end();

    const parsed = JSON.parse(chunks[0]!);
    expect(parsed).toHaveProperty('pid');
    expect(parsed).toHaveProperty('hostname');
  });
});
