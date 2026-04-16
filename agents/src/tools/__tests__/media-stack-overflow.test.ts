/**
 * Diagnostic harness: identify where "Maximum call stack size exceeded" occurs
 * when the Getty Images API returns 401.
 *
 * Tests are ordered from most isolated to most integrated.
 * Each test catches RangeError to detect stack overflow.
 *
 * Run: pnpm --filter @airo/agents test:unit "media-stack-overflow"
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mocks that must be hoisted ---

// Mock AppRepository before any import pulls it in
vi.mock('../../database/repositories/AppRepository.js', () => ({
  AppRepository: class {
    findById(id: string) {
      return {
        id,
        path: '/tmp/test-app',
        previewUrl: 'http://localhost:5173',
        name: 'test-app',
      };
    }
  },
}));

// Mock MediaManifestService - never reached on 401 path but imported at module level
vi.mock('../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    setSlot: vi.fn().mockResolvedValue({ success: true }),
    getManifest: vi.fn().mockResolvedValue({ success: true, manifest: {} }),
    getSlot: vi.fn().mockResolvedValue({ success: true, slot: null }),
  },
}));

// --- Real imports ---

import { serializeError, setLoggerFactory, createLogger } from '@airo/ai-common';
import { sanitizeLogEvent } from '../../logging/schemas/index.js';
import { DevelopmentHandler } from '../../logging/handlers/DevelopmentHandler.js';
import { ProductionHandler } from '../../logging/handlers/ProductionHandler.js';
import { Logger } from '../../logging/Logger.js';
import type { LogEvent } from '../../logging/types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Stub fetch to always return 401 Unauthorized */
function stubFetch401() {
  const mockFn = vi.fn().mockResolvedValue(
    new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' })
  );
  vi.stubGlobal('fetch', mockFn);
  return mockFn;
}

/** Run fn and return { threw: boolean, error?: Error } */
async function catchOverflow(fn: () => Promise<unknown> | unknown): Promise<{
  threw: boolean;
  isStackOverflow: boolean;
  error?: Error;
}> {
  try {
    await fn();
    return { threw: false, isStackOverflow: false };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return {
      threw: true,
      isStackOverflow: err instanceof RangeError && err.message.includes('Maximum call stack size exceeded'),
      error: err,
    };
  }
}

/** Build a LogEvent containing the given data - simulates what Logger.log() creates */
function buildLogEvent(data: Record<string, unknown>): LogEvent {
  return {
    timestamp: new Date().toISOString(),
    level: 'error',
    event: 'tool.execution.failure',
    message: 'tool: failure',
    data,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Media tool stack overflow diagnostic', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GETTY_TOKEN = 'test-token';
    process.env.GETTY_API_URL = 'http://fake-getty';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // ── Test 1: GettyMediaDriver.search() with 401 ──

  it('1. GettyMediaDriver.search() should handle 401 without stack overflow', async () => {
    stubFetch401();
    const { GettyMediaDriver } = await import('../ai-lib-tools/drivers/getty-media-driver.js');
    const driver = new GettyMediaDriver();

    const result = await catchOverflow(() =>
      driver.search({ query: 'test image', count: 1 })
    );

    // The driver catches its own error and returns { success: false } -
    // it should NOT overflow and should NOT throw (error is caught internally)
    expect(result.isStackOverflow).toBe(false);
    expect(result.threw).toBe(false);
  });

  // ── Test 2: serializeError() on a Getty-style error ──

  it('2. serializeError() should not overflow on Getty 401 error', async () => {
    const error = new Error('Getty API request failed: 401 Unauthorized');

    const result = await catchOverflow(() => serializeError(error));

    expect(result.isStackOverflow).toBe(false);
    if (!result.threw) {
      const serialized = serializeError(error);
      expect(serialized.message).toBe('Getty API request failed: 401 Unauthorized');
    }
  });

  // ── Test 3: serializeError() on an Error with extra properties ──

  it('3. serializeError() should not overflow on Error with nested object properties', async () => {
    const error = new Error('Getty API request failed: 401 Unauthorized');
    // Simulate properties that fetch Response or other Error subclasses might attach
    (error as any).status = 401;
    (error as any).response = { status: 401, body: 'Unauthorized' };
    (error as any).cause = new Error('fetch failed');

    const result = await catchOverflow(() => serializeError(error));
    expect(result.isStackOverflow).toBe(false);
  });

  // ── Test 4: sanitizeSensitiveData() via sanitizeLogEvent() ──

  it('4. sanitizeLogEvent() should not overflow on serialized error data', async () => {
    const serialized = serializeError(new Error('Getty API request failed: 401 Unauthorized'));
    const logEvent = buildLogEvent({
      toolName: 'media',
      error: serialized,
      args: { slot: 'hero', query: 'test' },
    });

    const result = await catchOverflow(() => sanitizeLogEvent(logEvent));
    expect(result.isStackOverflow).toBe(false);
  });

  // ── Test 5: sanitizeSensitiveData() with deeply nested object ──

  it('5. sanitizeLogEvent() should not overflow on deeply nested data', async () => {
    // Build a 500-level nested object to stress-test recursion
    let obj: any = { value: 'leaf' };
    for (let i = 0; i < 500; i++) {
      obj = { nested: obj };
    }

    const logEvent = buildLogEvent({ deep: obj });
    const result = await catchOverflow(() => sanitizeLogEvent(logEvent));
    expect(result.isStackOverflow).toBe(false);
  });

  // ── Test 6: sanitizeSensitiveData() with circular reference ──

  it('6. sanitizeLogEvent() handles circular references without overflow', async () => {
    const obj: any = { a: 1, b: { c: 2 } };
    obj.b.self = obj; // circular

    const logEvent = buildLogEvent({ circular: obj });
    const result = await catchOverflow(() => sanitizeLogEvent(logEvent));

    expect(result.isStackOverflow).toBe(false);
    expect(result.threw).toBe(false);
  });

  // ── Test 7: DevelopmentHandler with serialized error data ──

  it('7. DevelopmentHandler should not overflow on serialized error data', async () => {
    const handler = new DevelopmentHandler({ colorize: false, showTimestamps: false });
    const serialized = serializeError(new Error('Getty API request failed: 401 Unauthorized'));
    const logEvent = buildLogEvent({
      toolName: 'media',
      error: serialized,
      args: { slot: 'hero', query: 'test' },
    });

    const result = await catchOverflow(() => handler.handle(logEvent));
    expect(result.isStackOverflow).toBe(false);
  });

  // ── Test 8: DevelopmentHandler with circular reference in data ──

  it('8. DevelopmentHandler handles circular references in data without overflow', async () => {
    const handler = new DevelopmentHandler({ colorize: false, showTimestamps: false });
    const obj: any = { toolName: 'media', error: { message: 'test' } };
    obj.error.parent = obj; // circular

    const logEvent = buildLogEvent(obj);

    // DevelopmentHandler calls JSON.stringify which throws TypeError on circular refs,
    // but the handler's try/catch prevents it from being a stack overflow
    const result = await catchOverflow(() => handler.handle(logEvent));
    expect(result.isStackOverflow).toBe(false);
  });

  // ── Test 9: ProductionHandler with serialized error data ──

  it('9. ProductionHandler should not overflow on serialized error data', async () => {
    const mockWrite = vi.fn().mockReturnValue(true);
    const mockStream = { write: mockWrite } as unknown as NodeJS.WriteStream;
    const handler = new ProductionHandler({ output: mockStream, errorOutput: mockStream });

    const serialized = serializeError(new Error('Getty API request failed: 401 Unauthorized'));
    const logEvent = buildLogEvent({
      toolName: 'media',
      error: serialized,
      args: { slot: 'hero', query: 'test' },
    });

    const result = await catchOverflow(() => handler.handle(logEvent));
    expect(result.isStackOverflow).toBe(false);
  });

  // ── Test 10: ProductionHandler with circular reference ──

  it('10. ProductionHandler handles circular references without overflow', async () => {
    const mockWrite = vi.fn().mockReturnValue(true);
    const mockStream = { write: mockWrite } as unknown as NodeJS.WriteStream;
    const handler = new ProductionHandler({ output: mockStream, errorOutput: mockStream });

    const obj: any = { toolName: 'media' };
    obj.self = obj;
    const logEvent = buildLogEvent(obj);

    const result = await catchOverflow(() => handler.handle(logEvent));
    expect(result.isStackOverflow).toBe(false);
  });

  // ── Test 11: ProductionHandler.transformFieldNames() with circular reference ──

  it('11. ProductionHandler.transformFieldNames() handles circular reference without overflow', async () => {
    const mockWrite = vi.fn().mockReturnValue(true);
    const mockStream = { write: mockWrite } as unknown as NodeJS.WriteStream;
    const handler = new ProductionHandler({ output: mockStream, errorOutput: mockStream });

    // Build data with circular ref that goes through both sanitize + transformFieldNames
    const data: any = { appId: 'test', nested: { appId: 'inner' } };
    data.nested.parent = data;

    const logEvent: LogEvent = {
      timestamp: new Date().toISOString(),
      level: 'error',
      event: 'tool.execution.failure',
      message: 'test',
      data,
    };

    const result = await catchOverflow(() => handler.handle(logEvent));
    expect(result.isStackOverflow).toBe(false);
  });

  // ── Test 12: Full MediaSlotTool.selectMedia() with 401 ──

  it('12. MediaSlotTool.selectMedia() should return error without overflow on 401', async () => {
    stubFetch401();
    const { MediaSlotTool } = await import('../media-slot-tool.js');
    const tool = new MediaSlotTool();

    const result = await catchOverflow(() =>
      tool.selectMedia({
        slot: 'pages/home/hero',
        query: 'modern office',
        appId: 'test-app-id',
        mediaType: 'image',
        count: 1,
      })
    );

    expect(result.isStackOverflow).toBe(false);
    expect(result.threw).toBe(false);
  });

  // ── Test 13: Full hook wrapper path (simulating wrapToolWithExecutionHooks) ──

  it('13. Hook wrapper catch path should not overflow', async () => {
    // Simulate exactly what wrapToolWithExecutionHooks does on tool failure
    const toolError = new Error('Failed to select media');

    const result = await catchOverflow(async () => {
      // Step 1: serializeError (agent-factory.ts:445)
      const serializedError = serializeError(toolError);

      // Step 2: logger.error with serialized data (agent-factory.ts:446-458)
      // Build the exact data shape from the hook wrapper
      const logData = {
        toolName: 'media',
        args: { slot: 'pages/home/hero', query: 'modern office', mediaType: 'image' },
        error: serializedError,
        context: {
          sessionId: 'test-session',
          userId: 'test-user',
          metadata: { appId: 'test-app', conversationId: 'test-conv' },
          messageCount: 5,
          hasInitialContext: true,
          timestamp: Date.now(),
        },
      };

      // Step 3: sanitizeLogEvent (Logger.ts:204)
      const logEvent = buildLogEvent(logData);
      const sanitized = sanitizeLogEvent(logEvent);

      // Step 4: DevelopmentHandler (Logger.ts:209)
      const devHandler = new DevelopmentHandler({ colorize: false, showTimestamps: false });
      devHandler.handle(sanitized);

      // Step 5: ProductionHandler
      const mockWrite = vi.fn().mockReturnValue(true);
      const mockStream = { write: mockWrite } as unknown as NodeJS.WriteStream;
      const prodHandler = new ProductionHandler({ output: mockStream, errorOutput: mockStream });
      prodHandler.handle(sanitized);

      // Step 6: Re-throw clean error (agent-factory.ts:460-467)
      const errorMessage = typeof serializedError.message === 'string'
        ? serializedError.message
        : String(toolError);
      const cleanError = new Error(errorMessage);
      cleanError.name = typeof serializedError.name === 'string'
        ? serializedError.name
        : 'ToolExecutionError';
      throw cleanError;
    });

    // The throw is expected (the clean error), but it should NOT be a stack overflow
    expect(result.threw).toBe(true);
    expect(result.isStackOverflow).toBe(false);
    if (result.isStackOverflow) {
      console.log('[Test 13] CONFIRMED: Full hook wrapper path overflows');
    }
  });

  // ── Test 14: mediaSlotAITool execute() with 401 (closest to real path) ──

  it('14. mediaSlotAITool.execute() should throw without overflow on 401', async () => {
    stubFetch401();
    const { mediaSlotAITool } = await import('../ai-lib-tools/media-slot.js');

    // The tool expects context.metadata.appId
    const context = {
      metadata: { appId: 'test-app-id', sessionId: 'test-session' },
    };

    const result = await catchOverflow(() =>
      (mediaSlotAITool as any).execute(
        {
          slot: 'pages/home/hero',
          query: 'modern office',
          mediaType: 'image',
          count: 1,
        },
        { experimental_context: context }
      )
    );

    // Should throw (the tool throws on !result.success) but NOT stack overflow
    expect(result.threw).toBe(true);
    expect(result.isStackOverflow).toBe(false);
    if (result.isStackOverflow) {
      console.log('[Test 14] CONFIRMED: mediaSlotAITool.execute overflows on 401');
    } else if (result.threw) {
      console.log('[Test 14] Threw as expected:', result.error?.message);
    }
  });

  // ── Test 15: Full path - tool execute + hook wrapper + logging ──

  it('15. Full path: tool execute + serializeError + logging should not overflow', async () => {
    stubFetch401();
    const { mediaSlotAITool } = await import('../ai-lib-tools/media-slot.js');

    const context = {
      metadata: { appId: 'test-app-id', sessionId: 'test-session' },
    };

    const result = await catchOverflow(async () => {
      try {
        // Step 1: Execute the tool (will throw because Getty returns 401)
        await (mediaSlotAITool as any).execute(
          {
            slot: 'pages/home/hero',
            query: 'modern office',
            mediaType: 'image',
            count: 1,
          },
          { experimental_context: context }
        );
      } catch (error) {
        // Step 2: This is what wrapToolWithExecutionHooks does
        const serializedError = serializeError(error);

        // Step 3: Log the error (simulating logger.error call)
        const logData = {
          toolName: 'media',
          args: { slot: 'pages/home/hero', query: 'modern office' },
          error: serializedError,
          context: {
            sessionId: 'test-session',
            userId: 'test-user',
            metadata: { appId: 'test-app-id' },
            messageCount: 5,
            hasInitialContext: false,
            timestamp: Date.now(),
          },
        };

        const logEvent = buildLogEvent(logData);
        const sanitized = sanitizeLogEvent(logEvent);

        // Step 4: Run through both handlers
        const devHandler = new DevelopmentHandler({ colorize: false, showTimestamps: false });
        devHandler.handle(sanitized);

        const mockWrite = vi.fn().mockReturnValue(true);
        const mockStream = { write: mockWrite } as unknown as NodeJS.WriteStream;
        const prodHandler = new ProductionHandler({ output: mockStream, errorOutput: mockStream });
        prodHandler.handle(sanitized);

        // Step 5: Re-throw clean error
        const cleanError = new Error(
          typeof serializedError.message === 'string' ? serializedError.message : String(error)
        );
        throw cleanError;
      }
    });

    expect(result.threw).toBe(true); // Expected: clean error re-thrown
    expect(result.isStackOverflow).toBe(false);
    if (result.isStackOverflow) {
      console.log('[Test 15] CONFIRMED: Full path (tool + serialize + log) overflows');
    }
  });

  // ── Test 16: Full path with real Logger pipeline (production-like) ──

  it('16. Full path with real Logger + setLoggerFactory (production-like)', async () => {
    stubFetch401();

    // Configure Logger with both handlers (mimics production setup)
    const mockWrite = vi.fn().mockReturnValue(true);
    const mockStream = { write: mockWrite } as unknown as NodeJS.WriteStream;

    Logger.configure({
      level: 'debug',
      handlers: [
        new DevelopmentHandler({ colorize: false, showTimestamps: false }),
        new ProductionHandler({ output: mockStream, errorOutput: mockStream }),
      ],
    });

    // Wire up ai-common delegation (mimics agents/src/server/app.ts line 6)
    setLoggerFactory((moduleName) => Logger.create({ component: `ai-lib.${moduleName}` }));

    try {
      // Get the ai-common logger as agent-factory.ts does
      const agentFactoryLogger = createLogger('agent-factory');

      const { mediaSlotAITool } = await import('../ai-lib-tools/media-slot.js');
      const context = {
        metadata: { appId: 'test-app-id', sessionId: 'test-session' },
      };

      const result = await catchOverflow(async () => {
        try {
          // Execute the media tool (will throw on 401)
          await (mediaSlotAITool as any).execute(
            {
              slot: 'pages/home/hero',
              query: 'modern office',
              mediaType: 'image',
              count: 1,
            },
            { experimental_context: context }
          );
        } catch (error) {
          // Replicate wrapToolWithExecutionHooks catch block exactly
          const serializedError = serializeError(error);

          // This is the critical call - goes through ai-common -> agents Logger -> handlers
          agentFactoryLogger.error('tool.execution.failure', {
            toolName: 'media',
            args: { slot: 'pages/home/hero', query: 'modern office', mediaType: 'image', count: 1 },
            error: serializedError,
            context: {
              sessionId: 'test-session',
              userId: 'test-user',
              metadata: { appId: 'test-app-id', conversationId: 'test-conv' },
              messageCount: 10,
              hasInitialContext: true,
              timestamp: Date.now(),
            },
          });

          // Re-throw clean error
          const errorMessage = typeof serializedError.message === 'string'
            ? serializedError.message
            : String(error);
          const cleanError = new Error(errorMessage);
          cleanError.name = typeof serializedError.name === 'string'
            ? serializedError.name
            : 'ToolExecutionError';
          throw cleanError;
        }
      });

      expect(result.threw).toBe(true);
      expect(result.isStackOverflow).toBe(false);
    } finally {
      setLoggerFactory(null);
    }
  });

  // ── Test 17: Multiple concurrent media tool failures (stress test) ──

  it('17. Multiple concurrent media tool 401 failures should not overflow', async () => {
    stubFetch401();
    const { MediaSlotTool } = await import('../media-slot-tool.js');

    // Run 15 media searches concurrently (matches the 15 observed in production)
    const promises = Array.from({ length: 15 }, (_, i) => {
      const tool = new MediaSlotTool();
      return catchOverflow(() =>
        tool.selectMedia({
          slot: `pages/home/image-${i}`,
          query: `test image ${i}`,
          appId: 'test-app-id',
          mediaType: 'image',
          count: 1,
        })
      );
    });

    const results = await Promise.all(promises);

    const overflows = results.filter(r => r.isStackOverflow);
    expect(overflows.length).toBe(0);
    const throws = results.filter(r => r.threw);
    expect(throws.length).toBe(0);
  });

  // ── Test 18: ROOT CAUSE - stateManager in metadata causes overflow ──

  it('18. sanitizeSensitiveData handles metadata with stateManager Timeout (circular refs)', async () => {
    // In production, ai-lib-websocket-server.ts line 573 does:
    //   agentsAppContext.metadata.stateManager = stateManager
    //
    // When a tool fails, wrapToolWithExecutionHooks logs:
    //   logger.error('tool.execution.failure', { ..., context: { metadata: context.metadata } })
    //
    // context.metadata includes the SessionStateManager, which has a cleanupInterval
    // (a Node.js Timeout). Timeouts have circular _idlePrev/_idleNext linked list pointers.
    // sanitizeSensitiveData() recurses into these with no cycle detection -> stack overflow.

    // Simulate SessionStateManager which has a cleanupInterval (setInterval Timeout)
    // In production: ai-lib-websocket-server.ts line 573 sets metadata.stateManager
    const fakeStateManager = {
      sessions: new Map(),
      config: { defaultAgentId: 'develop', sessionTimeout: 3600000 },
      // This is the key: a real Node.js Timeout with circular _idlePrev/_idleNext
      cleanupInterval: setInterval(() => {}, 300000),
    };

    // Build metadata exactly as production does
    const metadata: Record<string, unknown> = {
      appId: 'test-app-id',
      sessionId: 'test-session',
      stateManager: fakeStateManager, // <-- this is the problem
    };

    // Build the log data that wrapToolWithExecutionHooks creates on error
    const logData = {
      toolName: 'media',
      args: { slot: 'pages/home/hero', query: 'modern office' },
      error: { name: 'Error', message: 'Getty API request failed: 401' },
      context: {
        sessionId: 'test-session',
        userId: 'test-user',
        metadata, // <-- includes stateManager with Timeout circular refs
        messageCount: 5,
        hasInitialContext: false,
        timestamp: Date.now(),
      },
    };

    const logEvent = buildLogEvent(logData);

    // This is where the stack overflow happens
    const result = await catchOverflow(() => sanitizeLogEvent(logEvent));

    // Clean up the interval
    clearInterval(fakeStateManager.cleanupInterval);

    // After fix: circular reference protection prevents overflow
    expect(result.isStackOverflow).toBe(false);
  });

  // ── Test 19: Full production path with stateManager in context ──

  it('19. Full production path: tool error + stateManager in metadata (no overflow after fix)', async () => {
    stubFetch401();

    // Same fake stateManager with a real Timeout (circular refs)
    const fakeStateManager = {
      sessions: new Map(),
      config: { defaultAgentId: 'develop', sessionTimeout: 3600000 },
      cleanupInterval: setInterval(() => {}, 300000),
    };

    // Configure Logger exactly as production
    const mockWrite = vi.fn().mockReturnValue(true);
    const mockStream = { write: mockWrite } as unknown as NodeJS.WriteStream;

    Logger.configure({
      level: 'debug',
      handlers: [
        new DevelopmentHandler({ colorize: false, showTimestamps: false }),
        new ProductionHandler({ output: mockStream, errorOutput: mockStream }),
      ],
    });

    setLoggerFactory((moduleName) => Logger.create({ component: `ai-lib.${moduleName}` }));

    try {
      const agentFactoryLogger = createLogger('agent-factory');
      const { mediaSlotAITool } = await import('../ai-lib-tools/media-slot.js');

      // Context with stateManager - exactly as production sets it up
      const context = {
        metadata: {
          appId: 'test-app-id',
          sessionId: 'test-session',
          stateManager: fakeStateManager, // <-- the smoking gun
        },
      };

      const result = await catchOverflow(async () => {
        try {
          await (mediaSlotAITool as any).execute(
            { slot: 'pages/home/hero', query: 'modern office', mediaType: 'image', count: 1 },
            { experimental_context: context }
          );
        } catch (error) {
          const serializedError = serializeError(error);

          // This is the exact call from agent-factory.ts line 446-458
          agentFactoryLogger.error('tool.execution.failure', {
            toolName: 'media',
            args: { slot: 'pages/home/hero', query: 'modern office', mediaType: 'image', count: 1 },
            error: serializedError,
            context: {
              sessionId: context.metadata.sessionId,
              userId: 'test-user',
              metadata: context.metadata, // <-- includes stateManager
              messageCount: 10,
              hasInitialContext: true,
              timestamp: Date.now(),
            },
          });

          const cleanError = new Error(
            typeof serializedError.message === 'string' ? serializedError.message : String(error)
          );
          throw cleanError;
        }
      });

      // After fix: circular reference protection prevents overflow
      expect(result.threw).toBe(true); // Expected: clean error re-thrown
      expect(result.isStackOverflow).toBe(false);
    } finally {
      clearInterval(fakeStateManager.cleanupInterval);
      setLoggerFactory(null);
    }
  });
});
