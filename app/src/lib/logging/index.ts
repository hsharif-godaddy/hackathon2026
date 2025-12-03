/**
 * Client-Side Logging Module
 *
 * Provides structured logging for client-side code with automatic
 * environment-aware behavior:
 * - Development: Console output for debugging
 * - Production: Batched shipping to Elasticsearch via /api/client-logs
 *
 * @example
 * ```typescript
 * import { ClientLogBuffer } from '@/lib/logging';
 *
 * // Initialize once at app startup (e.g., in _app.tsx or layout.tsx)
 * ClientLogBuffer.init();
 *
 * // Logs are automatically buffered and shipped
 * // Manual flush if needed:
 * await ClientLogBuffer.flush();
 * ```
 */

export { ClientLogBuffer } from './client-log-buffer';
export type { ClientLogBufferConfig } from './client-log-buffer';

