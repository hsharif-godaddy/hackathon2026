/**
 * LLM Tracing utilities for debugging agent interactions
 */

export interface TraceEvent {
  id: string;
  timestamp: Date;
  type: 'request' | 'response' | 'error' | 'debug' | 'tool_call';
  agentId?: string | undefined;
  threadId?: string | undefined;
  data: Record<string, unknown>;
}

export class Tracer {
  private events: TraceEvent[] = [];
  private enabled: boolean;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  trace(event: Omit<TraceEvent, 'id' | 'timestamp'>): void {
    if (!this.enabled) return;

    const traceEvent: TraceEvent = {
      id: `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      ...event,
    };

    this.events.push(traceEvent);
    
    // Console logging for immediate debugging
    const logLevel = this.getLogLevel(event.type);
    const message = this.formatTraceEvent(traceEvent);
    
    console[logLevel](message);
  }

  private getLogLevel(type: TraceEvent['type']): 'log' | 'warn' | 'error' | 'debug' {
    switch (type) {
      case 'error':
        return 'error';
      case 'debug':
        return 'debug';
      case 'request':
      case 'response':
      case 'tool_call':
        return 'log';
      default:
        return 'log';
    }
  }

  private formatTraceEvent(event: TraceEvent): string {
    const timestamp = event.timestamp.toISOString();
    const prefix = `[${timestamp}] ${event.type.toUpperCase()}`;
    const context = event.agentId ? ` [${event.agentId}]` : '';
    const thread = event.threadId ? ` [thread:${event.threadId.substr(0, 8)}]` : '';
    
    return `${prefix}${context}${thread}: ${JSON.stringify(event.data, null, 2)}`;
  }

  getEvents(filters?: {
    agentId?: string;
    threadId?: string;
    type?: TraceEvent['type'];
    since?: Date;
  }): TraceEvent[] {
    let filtered = this.events;

    if (filters?.agentId) {
      filtered = filtered.filter(e => e.agentId === filters.agentId);
    }

    if (filters?.threadId) {
      filtered = filtered.filter(e => e.threadId === filters.threadId);
    }

    if (filters?.type) {
      filtered = filtered.filter(e => e.type === filters.type);
    }

    if (filters?.since) {
      filtered = filtered.filter(e => e.timestamp >= filters.since!);
    }

    return filtered;
  }

  clear(): void {
    this.events = [];
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

// Global tracer instance
export const globalTracer = new Tracer(process.env.NODE_ENV !== 'production');
