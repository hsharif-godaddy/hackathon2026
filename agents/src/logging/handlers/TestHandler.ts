import type { LogHandler, LogEvent, LogLevel } from '../types.js';

/**
 * Test handler that buffers log events in memory for testing assertions
 */
export class TestHandler implements LogHandler {
  private events: LogEvent[] = [];
  private maxEvents: number;

  constructor(options: {
    maxEvents?: number;
  } = {}) {
    this.maxEvents = options.maxEvents ?? 1000;
  }

  handle(event: LogEvent): void {
    this.events.push({ ...event });
    
    // Keep buffer size under control
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  /**
   * Get all captured events
   */
  getEvents(): LogEvent[] {
    return [...this.events];
  }

  /**
   * Get events filtered by level
   */
  getEventsByLevel(level: LogLevel): LogEvent[] {
    return this.events.filter(event => event.level === level);
  }

  /**
   * Get events filtered by event type
   */
  getEventsByType(eventType: string): LogEvent[] {
    return this.events.filter(event => event.event === eventType);
  }

  /**
   * Get events filtered by domain
   */
  getEventsByDomain(domain: string): LogEvent[] {
    return this.events.filter(event => event.event.startsWith(domain + '.'));
  }

  /**
   * Get events that contain specific data
   */
  getEventsWithData(predicate: (data: any) => boolean): LogEvent[] {
    return this.events.filter(event => event.data && predicate(event.data));
  }

  /**
   * Get the most recent event
   */
  getLastEvent(): LogEvent | undefined {
    return this.events[this.events.length - 1];
  }

  /**
   * Get the most recent event of a specific type
   */
  getLastEventByType(eventType: string): LogEvent | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event?.event === eventType) {
        return event;
      }
    }
    return undefined;
  }

  /**
   * Check if any event matches the criteria
   */
  hasEvent(predicate: (event: LogEvent) => boolean): boolean {
    return this.events.some(predicate);
  }

  /**
   * Count events matching criteria
   */
  countEvents(predicate: (event: LogEvent) => boolean): number {
    return this.events.filter(predicate).length;
  }

  /**
   * Wait for a specific event (useful for async testing)
   */
  async waitForEvent(
    predicate: (event: LogEvent) => boolean,
    timeoutMs: number = 5000
  ): Promise<LogEvent> {
    return new Promise((resolve, reject) => {
      // Check if event already exists
      const existingEvent = this.events.find(predicate);
      if (existingEvent) {
        resolve(existingEvent);
        return;
      }

      const cleanup = () => {
        if (timeout) {clearTimeout(timeout);}
        if (checkInterval) {clearInterval(checkInterval);}
      };

      // Set timeout
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for log event after ${timeoutMs}ms`));
      }, timeoutMs);

      // Check for event periodically
      const checkInterval = setInterval(() => {
        const event = this.events.find(predicate);
        if (event) {
          cleanup();
          resolve(event);
        }
      }, 10);
    });
  }

  /**
   * Clear all captured events
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Get summary statistics about captured events
   */
  getStats(): {
    total: number;
    byLevel: Record<LogLevel, number>;
    byDomain: Record<string, number>;
    timeRange?: { start: string; end: string };
  } {
    const stats: {
      total: number;
      byLevel: Record<LogLevel, number>;
      byDomain: Record<string, number>;
      timeRange?: { start: string; end: string };
    } = {
      total: this.events.length,
      byLevel: {
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
        fatal: 0,
      } as Record<LogLevel, number>,
      byDomain: {} as Record<string, number>,
    };

    if (this.events.length === 0) {
      return stats;
    }

    // Calculate stats
    for (const event of this.events) {
      stats.byLevel[event.level]++;
      
      const domain = event.event.split('.')[0];
      if (domain) {
        stats.byDomain[domain] = (stats.byDomain[domain] || 0) + 1;
      }
    }

    // Time range
    if (this.events.length > 0) {
      const firstEvent = this.events[0];
      const lastEvent = this.events[this.events.length - 1];
      if (firstEvent && lastEvent) {
        stats.timeRange = {
          start: firstEvent.timestamp,
          end: lastEvent.timestamp,
        };
      }
    }

    return stats;
  }

  /**
   * Export events as JSON for debugging
   */
  exportEvents(): string {
    return JSON.stringify(this.events, null, 2);
  }

  /**
   * Create assertion helpers for common test patterns
   */
  createAssertions() {
    return {
      hasEventType: (eventType: string) => {
        const event = this.getLastEventByType(eventType);
        if (!event) {
          throw new Error(`Expected event type '${eventType}' but none found`);
        }
        return event;
      },

      hasErrorEvent: (errorMessage?: string) => {
        const errorEvents = this.getEventsByLevel('error');
        if (errorEvents.length === 0) {
          throw new Error('Expected error event but none found');
        }
        
        if (errorMessage) {
          const matchingEvent = errorEvents.find(e => 
            e.error?.message.includes(errorMessage) || e.message.includes(errorMessage)
          );
          if (!matchingEvent) {
            throw new Error(`Expected error event with message containing '${errorMessage}' but none found`);
          }
          return matchingEvent;
        }
        
        return errorEvents[errorEvents.length - 1];
      },

      hasNoErrors: () => {
        const errorEvents = this.getEventsByLevel('error');
        if (errorEvents.length > 0) {
          throw new Error(`Expected no error events but found ${errorEvents.length}: ${errorEvents.map(e => e.message).join(', ')}`);
        }
      },

      eventCount: (expectedCount: number) => {
        if (this.events.length !== expectedCount) {
          throw new Error(`Expected ${expectedCount} events but found ${this.events.length}`);
        }
      },

      domainEventCount: (domain: string, expectedCount: number) => {
        const domainEvents = this.getEventsByDomain(domain);
        if (domainEvents.length !== expectedCount) {
          throw new Error(`Expected ${expectedCount} '${domain}' events but found ${domainEvents.length}`);
        }
      },
    };
  }

  flush(): void {
    // Memory buffer doesn't need flushing
  }
}