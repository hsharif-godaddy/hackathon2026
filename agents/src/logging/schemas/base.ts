import { z } from 'zod';

/**
 * Base schemas for logging system
 */

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error', 'fatal']);

export const LogContextSchema = z.object({
  appId: z.string().optional(),
  agentId: z.string().optional(),
  userId: z.string().optional(),
  requestId: z.string().optional(),
  conversationId: z.string().optional(),
  component: z.string().optional(),
  version: z.string().optional(),
}).passthrough(); // Allow additional properties

export const LogErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
  code: z.union([z.string(), z.number()]).optional(),
});

export const LogEventSchema = z.object({
  // Required fields
  timestamp: z.string().datetime(),
  level: LogLevelSchema,
  event: z.string().min(1),
  message: z.string(),
  
  // Contextual fields
  appId: z.string().optional(),
  agentId: z.string().optional(),
  userId: z.string().optional(),
  requestId: z.string().optional(),
  conversationId: z.string().optional(),
  productId: z.string().optional(),
  
  // Event data
  data: z.record(z.string(), z.any()).optional(),
  
  // Technical fields
  duration: z.number().positive().optional(),
  error: LogErrorSchema.optional(),
  
  // Metadata
  tags: z.array(z.string()).optional(),
  meta: z.record(z.string(), z.any()).optional(),
});

export const LogOptionsSchema = z.object({
  duration: z.number().positive().optional(),
  tags: z.array(z.string()).optional(),
  meta: z.record(z.string(), z.any()).optional(),
});

export const LoggerConfigSchema = z.object({
  level: LogLevelSchema,
  handlers: z.array(z.any()), // We can't validate handlers here as they're class instances
  context: LogContextSchema.optional(),
  enabledDomains: z.array(z.string()).optional(),
  disabledDomains: z.array(z.string()).optional(),
});

export type LogLevel = z.infer<typeof LogLevelSchema>;
export type LogContext = z.infer<typeof LogContextSchema>;
export type LogError = z.infer<typeof LogErrorSchema>;
export type LogEvent = z.infer<typeof LogEventSchema>;
export type LogOptions = z.infer<typeof LogOptionsSchema>;
export type LoggerConfig = z.infer<typeof LoggerConfigSchema>;
