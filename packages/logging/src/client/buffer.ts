export interface ClientLogBufferConfig {
  maxBuffer: number;
  flushInterval: number;
  maxFailures: number;
  maxOverflow: number;
  endpoint: string;
  initialRetryDelay: number;
  maxRetryDelay: number;
}

const DEFAULT_CONFIG: ClientLogBufferConfig = {
  maxBuffer: 50,
  flushInterval: 5000,
  maxFailures: 5,
  maxOverflow: 200,
  endpoint: '/api/client-logs',
  initialRetryDelay: 1000,
  maxRetryDelay: 30000,
};

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export class ClientLogBuffer {
  private static instance: ClientLogBuffer | null = null;
  private static initialized = false;

  private buffer: Record<string, unknown>[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isShipping = false;
  private failedCount = 0;
  private sessionId: string | null = null;
  private config: ClientLogBufferConfig;
  private boundOnVisibilityChange: (() => void) | null = null;
  private boundOnBeforeUnload: (() => void) | null = null;

  private constructor(config?: Partial<ClientLogBufferConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  static getInstance(config?: Partial<ClientLogBufferConfig>): ClientLogBuffer {
    if (!ClientLogBuffer.instance) {
      ClientLogBuffer.instance = new ClientLogBuffer(config);
    }
    return ClientLogBuffer.instance;
  }

  static init(config?: Partial<ClientLogBufferConfig>): void {
    if (!isBrowser()) return;
    if (ClientLogBuffer.initialized) return;
    const instance = ClientLogBuffer.getInstance(config);
    instance.setupEventListeners();
    ClientLogBuffer.initialized = true;
  }

  static isInitialized(): boolean {
    return ClientLogBuffer.initialized;
  }

  static reset(): void {
    if (ClientLogBuffer.instance) {
      ClientLogBuffer.instance.destroy();
      ClientLogBuffer.instance = null;
    }
    ClientLogBuffer.initialized = false;
  }

  static add(log: Record<string, unknown>): void {
    if (!isBrowser()) return;
    if (!ClientLogBuffer.initialized) ClientLogBuffer.init();
    ClientLogBuffer.getInstance().addLog(log);
  }

  static async flush(): Promise<void> {
    if (!isBrowser() || !ClientLogBuffer.instance) return;
    return ClientLogBuffer.instance.flushLogs();
  }

  static getSessionId(): string {
    if (!isBrowser()) return '';
    return ClientLogBuffer.getInstance().getOrCreateSessionId();
  }

  static getBufferSize(): number {
    return ClientLogBuffer.instance?.buffer.length ?? 0;
  }

  static getConfig(): ClientLogBufferConfig {
    return ClientLogBuffer.getInstance().config;
  }

  private setupEventListeners(): void {
    if (!isBrowser()) return;
    this.boundOnVisibilityChange = () => {
      if (document.visibilityState === 'hidden') this.flushLogs();
    };
    this.boundOnBeforeUnload = () => {
      this.flushLogs();
    };
    document.addEventListener('visibilitychange', this.boundOnVisibilityChange);
    window.addEventListener('beforeunload', this.boundOnBeforeUnload);
  }

  private destroy(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (isBrowser()) {
      if (this.boundOnVisibilityChange) {
        document.removeEventListener('visibilitychange', this.boundOnVisibilityChange);
      }
      if (this.boundOnBeforeUnload) {
        window.removeEventListener('beforeunload', this.boundOnBeforeUnload);
      }
    }
    this.boundOnVisibilityChange = null;
    this.boundOnBeforeUnload = null;
    this.buffer = [];
  }

  private getOrCreateSessionId(): string {
    if (this.sessionId) return this.sessionId;
    try {
      const existing = sessionStorage.getItem('log_session_id');
      if (existing) {
        this.sessionId = existing;
      } else {
        this.sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        sessionStorage.setItem('log_session_id', this.sessionId);
      }
    } catch {
      this.sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
    return this.sessionId;
  }

  private addLog(log: Record<string, unknown>): void {
    if (this.buffer.length >= this.config.maxOverflow) {
      this.buffer.shift();
    }
    this.buffer.push(log);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.buffer.length >= this.config.maxBuffer) {
      this.flushLogs();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushLogs();
      }, this.config.flushInterval);
    }
  }

  private scheduleRetry(): void {
    if (this.failedCount >= this.config.maxFailures) return;
    const delay = Math.min(
      this.config.initialRetryDelay * Math.pow(2, this.failedCount - 1),
      this.config.maxRetryDelay,
    );
    setTimeout(() => this.flushLogs(), delay);
  }

  async flushLogs(): Promise<void> {
    if (this.buffer.length === 0 || this.isShipping) return;
    if (this.failedCount >= this.config.maxFailures) return;

    this.isShipping = true;
    const batch = this.buffer.splice(0, this.config.maxBuffer);

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': '1' },
        credentials: 'include',
        body: JSON.stringify({ logs: batch }),
        keepalive: true,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.failedCount = 0;
    } catch {
      this.failedCount++;
      if (this.buffer.length < this.config.maxOverflow - batch.length) {
        this.buffer.unshift(...batch);
      }
      this.scheduleRetry();
    } finally {
      this.isShipping = false;
    }
  }
}
