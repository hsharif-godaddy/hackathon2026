/**
 * Client Log Buffer for Batched Shipping
 *
 * Collects client-side logs and ships them to /api/client-logs in batches
 * for efficient transport to Elasticsearch.
 *
 * Features:
 * - Configurable via environment variables
 * - Exponential backoff on failures
 * - Lazy initialization (no global side effects)
 * - Session correlation via sessionStorage
 * - Reliable delivery via sendBeacon on page unload
 *
 * @example
 * ```typescript
 * import { ClientLogBuffer } from '@/lib/logging/client-log-buffer';
 *
 * // Initialize once at app startup
 * ClientLogBuffer.init();
 *
 * // Add logs to buffer
 * ClientLogBuffer.add({ level: 'error', event: 'api.failure', ... });
 *
 * // Buffer auto-flushes, or manually flush
 * await ClientLogBuffer.flush();
 * ```
 */

/**
 * Configuration for the client log buffer
 */
export interface ClientLogBufferConfig {
  /** Maximum logs to buffer before auto-flush */
  maxBuffer: number;
  /** Milliseconds between auto-flushes */
  flushInterval: number;
  /** Maximum failures before giving up */
  maxFailures: number;
  /** Maximum buffer size to prevent memory issues */
  maxOverflow: number;
  /** API endpoint for log shipping */
  endpoint: string;
  /** Initial retry delay in milliseconds */
  initialRetryDelay: number;
  /** Maximum retry delay in milliseconds */
  maxRetryDelay: number;
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: ClientLogBufferConfig = {
  maxBuffer: 50,
  flushInterval: 5000,
  maxFailures: 5,
  maxOverflow: 200,
  endpoint: '/api/client-logs',
  initialRetryDelay: 1000,
  maxRetryDelay: 30000,
};

/**
 * Check if running in browser environment
 *
 * @returns True if in browser context
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/**
 * Client Log Buffer Class
 *
 * Manages client-side log collection and batched shipping to server.
 * Uses singleton pattern with lazy initialization.
 */
export class ClientLogBuffer {
  private static instance: ClientLogBuffer | null = null;
  private static initialized = false;

  private buffer: Record<string, unknown>[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isShipping = false;
  private failedCount = 0;
  private sessionId: string | null = null;
  private config: ClientLogBufferConfig;
  private currentRetryDelay: number;

  /**
   * Private constructor - use getInstance() instead
   *
   * @param config - Optional configuration override
   */
  private constructor(config?: Partial<ClientLogBufferConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentRetryDelay = this.config.initialRetryDelay;
  }

  /**
   * Get singleton instance
   *
   * @param config - Optional configuration override (only used on first call)
   * @returns ClientLogBuffer instance
   */
  static getInstance(config?: Partial<ClientLogBufferConfig>): ClientLogBuffer {
    if (!ClientLogBuffer.instance) {
      ClientLogBuffer.instance = new ClientLogBuffer(config);
    }
    return ClientLogBuffer.instance;
  }

  /**
   * Initialize the buffer with event listeners
   * Call this once at application startup
   *
   * @param config - Optional configuration override
   */
  static init(config?: Partial<ClientLogBufferConfig>): void {
    if (!isBrowser()) {return;}
    if (ClientLogBuffer.initialized) {return;}

    const instance = ClientLogBuffer.getInstance(config);
    instance.setupEventListeners();
    ClientLogBuffer.initialized = true;
  }

  /**
   * Check if buffer has been initialized
   *
   * @returns True if init() has been called
   */
  static isInitialized(): boolean {
    return ClientLogBuffer.initialized;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static reset(): void {
    if (ClientLogBuffer.instance) {
      ClientLogBuffer.instance.destroy();
      ClientLogBuffer.instance = null;
    }
    ClientLogBuffer.initialized = false;
  }

  /**
   * Add a log entry to the buffer
   * Static method for convenience
   *
   * @param log - Log entry to buffer
   */
  static add(log: Record<string, unknown>): void {
    if (!isBrowser()) {return;}

    // Auto-initialize if not already done (backwards compatibility)
    if (!ClientLogBuffer.initialized) {
      ClientLogBuffer.init();
    }

    ClientLogBuffer.getInstance().addLog(log);
  }

  /**
   * Flush buffered logs to server
   * Static method for convenience
   *
   * @returns Promise that resolves when flush completes
   */
  static async flush(): Promise<void> {
    if (!isBrowser()) {return;}
    if (!ClientLogBuffer.instance) {return;}

    return ClientLogBuffer.instance.flushLogs();
  }

  /**
   * Get or create session ID for log correlation
   * Static method for convenience
   *
   * @returns Session identifier string
   */
  static getSessionId(): string {
    if (!isBrowser()) {return '';}
    return ClientLogBuffer.getInstance().getOrCreateSessionId();
  }

  /**
   * Get current buffer size (useful for testing/debugging)
   *
   * @returns Number of buffered logs
   */
  static getBufferSize(): number {
    if (!ClientLogBuffer.instance) {return 0;}
    return ClientLogBuffer.instance.buffer.length;
  }

  /**
   * Get current configuration
   *
   * @returns Current configuration object
   */
  static getConfig(): ClientLogBufferConfig {
    return ClientLogBuffer.getInstance().config;
  }

  /**
   * Setup visibility and unload event listeners
   */
  private setupEventListeners(): void {
    if (!isBrowser()) {return;}

    // Flush on page visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.flushLogs();
      }
    });

    // Flush on page unload (backup)
    window.addEventListener('beforeunload', () => {
      this.flushLogs();
    });
  }

  /**
   * Clean up resources
   */
  private destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.buffer = [];
  }

  /**
   * Get or create session ID
   *
   * @returns Session identifier string
   */
  private getOrCreateSessionId(): string {
    if (this.sessionId) {return this.sessionId;}

    try {
      const existing = sessionStorage.getItem('log_session_id');
      if (existing) {
        this.sessionId = existing;
      } else {
        this.sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        sessionStorage.setItem('log_session_id', this.sessionId);
      }
    } catch {
      // sessionStorage may be unavailable (private browsing, etc.)
      this.sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    return this.sessionId;
  }

  /**
   * Add a log entry to the buffer
   *
   * @param log - Log entry to buffer
   */
  private addLog(log: Record<string, unknown>): void {
    // Prevent buffer overflow - drop oldest
    if (this.buffer.length >= this.config.maxOverflow) {
      this.buffer.shift();
    }

    this.buffer.push(log);
    this.scheduleFlush();
  }

  /**
   * Schedule a flush operation
   */
  private scheduleFlush(): void {
    // Immediate flush if buffer is full
    if (this.buffer.length >= this.config.maxBuffer) {
      this.flushLogs();
      return;
    }

    // Schedule delayed flush if not already scheduled
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushLogs();
      }, this.config.flushInterval);
    }
  }

  /**
   * Calculate next retry delay with exponential backoff
   *
   * @returns Delay in milliseconds
   */
  private calculateBackoff(): number {
    const delay = Math.min(
      this.currentRetryDelay * Math.pow(2, this.failedCount - 1),
      this.config.maxRetryDelay
    );
    return delay;
  }

  /**
   * Schedule retry with exponential backoff
   */
  private scheduleRetry(): void {
    if (this.failedCount >= this.config.maxFailures) {return;}

    const delay = this.calculateBackoff();

    setTimeout(() => {
      this.flushLogs();
    }, delay);
  }

  /**
   * Flush buffered logs to server
   *
   * @returns Promise that resolves when flush completes
   */
  async flushLogs(): Promise<void> {
    if (this.buffer.length === 0) {return;}
    if (this.isShipping) {return;}
    if (this.failedCount >= this.config.maxFailures) {return;}

    this.isShipping = true;
    const batch = this.buffer.splice(0, this.config.maxBuffer);

    try {
      const payload = JSON.stringify({ logs: batch });

      // Use fetch with keepalive: true for reliable delivery even on page unload
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': '1',
        },
        credentials: 'include',
        body: payload,
        keepalive: true,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      // Success - reset failure tracking
      this.failedCount = 0;
      this.currentRetryDelay = this.config.initialRetryDelay;
    } catch {
      this.failedCount++;

      // Re-queue failed logs (prepend to maintain order)
      if (this.buffer.length < this.config.maxOverflow - batch.length) {
        this.buffer.unshift(...batch);
      }

      // Schedule retry with backoff
      this.scheduleRetry();
    } finally {
      this.isShipping = false;
    }
  }
}

