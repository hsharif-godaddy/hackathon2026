/**
 * LLM Tracing utilities for debugging agent interactions
 */

import { logger } from '../logging/index.js';
import { tracingEvents } from '../logging/events/index.js';

export interface TraceEvent {
  id: string;
  timestamp: Date;
  type: 'request' | 'response' | 'error' | 'debug' | 'tool_call' | 'websocket';
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
    if (!this.enabled) {return;}

    const traceEvent: TraceEvent = {
      id: `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      ...event,
    };

    this.events.push(traceEvent);
    
    // Use structured logging instead of console
    this.logTraceEventStructured(traceEvent);
  }

  private logTraceEventStructured(traceEvent: TraceEvent): void {
    const tracingData: any = {
      traceId: traceEvent.id,
      eventType: traceEvent.type,
      data: traceEvent.data
    };
    
    if (traceEvent.agentId) {tracingData.agentId = traceEvent.agentId;}
    if (traceEvent.threadId) {tracingData.threadId = traceEvent.threadId;}

    switch (traceEvent.type) {
      case 'request':
        tracingEvents.request(logger, tracingData);
        break;
      case 'response':
        tracingEvents.response(logger, tracingData);
        break;
      case 'error':
        tracingEvents.error(logger, tracingData);
        break;
      case 'debug':
        tracingEvents.debug(logger, tracingData);
        break;
      case 'tool_call':
        tracingEvents.toolCall(logger, tracingData);
        break;
      case 'websocket':
        tracingEvents.websocket(logger, tracingData);
        break;
      default:
        tracingEvents.debug(logger, tracingData);
    }
  }

  // Keeping formatTraceEvent for backward compatibility in case other parts use it
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
