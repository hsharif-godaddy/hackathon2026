import { Writable } from 'node:stream';
import type { LogEvent, LogLevel } from '../types.js';

/**
 * In-memory Pino destination that buffers parsed log events for test assertions.
 */
export class TestDestination extends Writable {
  private events: LogEvent[] = [];
  private maxEvents: number;

  constructor(options: { maxEvents?: number } = {}) {
    super();
    this.maxEvents = options.maxEvents ?? 1000;
  }

  _write(chunk: Buffer, _encoding: string, callback: () => void): void {
    try {
      const parsed = JSON.parse(chunk.toString()) as LogEvent;
      this.events.push(parsed);
      if (this.events.length > this.maxEvents) {
        this.events.shift();
      }
    } catch {
      // Ignore unparseable lines
    }
    callback();
  }

  getEvents(): LogEvent[] {
    return [...this.events];
  }

  getEventsByLevel(level: LogLevel): LogEvent[] {
    return this.events.filter(e => e.level === level);
  }

  getEventsByType(eventType: string): LogEvent[] {
    return this.events.filter(e => e.event === eventType);
  }

  getEventsByDomain(domain: string): LogEvent[] {
    return this.events.filter(e => e.event.startsWith(domain + '.'));
  }

  getEventsWithData(predicate: (data: unknown) => boolean): LogEvent[] {
    return this.events.filter(e => e.data && predicate(e.data));
  }

  getLastEvent(): LogEvent | undefined {
    return this.events[this.events.length - 1];
  }

  getLastEventByType(eventType: string): LogEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i]?.event === eventType) return this.events[i];
    }
    return undefined;
  }

  hasEvent(predicate: (event: LogEvent) => boolean): boolean {
    return this.events.some(predicate);
  }

  countEvents(predicate: (event: LogEvent) => boolean): number {
    return this.events.filter(predicate).length;
  }

  clear(): void {
    this.events = [];
  }

  getStats(): {
    total: number;
    byLevel: Record<LogLevel, number>;
    byDomain: Record<string, number>;
  } {
    const stats = {
      total: this.events.length,
      byLevel: { debug: 0, info: 0, warn: 0, error: 0, fatal: 0 } as Record<LogLevel, number>,
      byDomain: {} as Record<string, number>,
    };

    for (const event of this.events) {
      stats.byLevel[event.level]++;
      const domain = event.event.split('.')[0];
      if (domain) {
        stats.byDomain[domain] = (stats.byDomain[domain] || 0) + 1;
      }
    }

    return stats;
  }
}
