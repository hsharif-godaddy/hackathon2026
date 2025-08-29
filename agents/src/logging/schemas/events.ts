import { z } from 'zod';
import { LogEventSchema } from './base.js';

/**
 * Domain-specific event schemas and validation
 */

// App lifecycle events
export const AppEventSchema = LogEventSchema.extend({
  event: z.string().regex(/^app\./),
  data: z.object({
    appId: z.string().optional(),
    name: z.string().optional(),
    path: z.string().optional(),
    port: z.number().optional(),
    status: z.string().optional(),
    adapterType: z.string().optional(),
    templateVersion: z.string().optional(),
  }).passthrough().optional(),
});

// Agent operation events  
export const AgentEventSchema = LogEventSchema.extend({
  event: z.string().regex(/^agent\./),
  data: z.object({
    agentId: z.string().optional(),
    toolName: z.string().optional(),
    templateName: z.string().optional(),
    promptTokens: z.number().optional(),
    completionTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    model: z.string().optional(),
    conversationId: z.string().optional(),
  }).passthrough().optional(),
});

// File operation events
export const FileEventSchema = LogEventSchema.extend({
  event: z.string().regex(/^file\./),
  data: z.object({
    path: z.string().optional(),
    size: z.number().optional(),
    mode: z.string().optional(),
    selector: z.string().optional(),
    property: z.string().optional(),
    value: z.any().optional(),
    oldText: z.string().optional(),
    newText: z.string().optional(),
  }).passthrough().optional(),
});

// API operation events
export const APIEventSchema = LogEventSchema.extend({
  event: z.string().regex(/^api\./),
  data: z.object({
    method: z.string().optional(),
    url: z.string().optional(),
    statusCode: z.number().optional(),
    userAgent: z.string().optional(),
    ip: z.string().optional(),
    responseTime: z.number().optional(),
  }).passthrough().optional(),
});

// Database operation events
export const DatabaseEventSchema = LogEventSchema.extend({
  event: z.string().regex(/^db\./),
  data: z.object({
    query: z.string().optional(),
    table: z.string().optional(),
    rowsAffected: z.number().optional(),
    migrationVersion: z.string().optional(),
  }).passthrough().optional(),
});

// WebSocket events
export const WebSocketEventSchema = LogEventSchema.extend({
  event: z.string().regex(/^ws\./),
  data: z.object({
    connectionId: z.string().optional(),
    messageType: z.string().optional(),
    messageSize: z.number().optional(),
    clientCount: z.number().optional(),
  }).passthrough().optional(),
});

// Performance events
export const PerformanceEventSchema = LogEventSchema.extend({
  event: z.string().regex(/^perf\./),
  data: z.object({
    operation: z.string().optional(),
    memoryUsage: z.number().optional(),
    cpuUsage: z.number().optional(),
    heapUsed: z.number().optional(),
    heapTotal: z.number().optional(),
  }).passthrough().optional(),
});

// Map of event patterns to their schemas
export const EVENT_SCHEMAS = {
  app: AppEventSchema,
  agent: AgentEventSchema,
  file: FileEventSchema,
  api: APIEventSchema,
  db: DatabaseEventSchema,
  ws: WebSocketEventSchema,
  perf: PerformanceEventSchema,
} as const;

export type AppEvent = z.infer<typeof AppEventSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type FileEvent = z.infer<typeof FileEventSchema>;
export type APIEvent = z.infer<typeof APIEventSchema>;
export type DatabaseEvent = z.infer<typeof DatabaseEventSchema>;
export type WebSocketEvent = z.infer<typeof WebSocketEventSchema>;
export type PerformanceEvent = z.infer<typeof PerformanceEventSchema>;