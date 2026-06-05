import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockLogger, fsMocks, envMocks } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  fsMocks: { existsSync: vi.fn(), readFileSync: vi.fn() },
  envMocks: { env: { NOMAD_ALLOC_DIR: undefined as string | undefined } },
}));

vi.mock('../../../logging/index.js', () => ({ logger: mockLogger }));
vi.mock('node:fs', () => fsMocks);
vi.mock('node:process', () => ({ env: envMocks.env }));

// ── MCP client factory mock ──────────────────────────────────────────────────

const makeFakeClient = (tools: Record<string, object> = {}) => ({
  tools: vi.fn().mockResolvedValue(tools),
  close: vi.fn().mockResolvedValue(undefined),
});

const mockCreateMCPClient = vi.fn();
vi.mock('@ai-sdk/mcp', () => ({ createMCPClient: mockCreateMCPClient }));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal config.json VALUE wrapper for a set of key→value pairs. */
function makeConfig(entries: Record<string, string>): string {
  const obj: Record<string, { VALUE: string }> = {};
  for (const [k, v] of Object.entries(entries)) {
    obj[k] = { VALUE: v };
  }
  return JSON.stringify(obj);
}

function setupLocalConfig(appId: string, mcpKey: string): void {
  envMocks.env.NOMAD_ALLOC_DIR = undefined;
  fsMocks.existsSync.mockReturnValue(true);
  fsMocks.readFileSync.mockReturnValue(makeConfig({ STRIPE_MCP_KEY: mcpKey }));
  process.env.APPS_BASE_DIR = '/test-apps';
  // The config path is APPS_BASE_DIR/<appId>/local/preview/config.json —
  // we don't assert on the exact path here; existsSync/readFileSync always
  // return the value above for any path.
}

// ── Import under test (after mocks are wired) ────────────────────────────────

const { loadStripeMcpTools, _resetStripeMcpClientCache, _MCP_SESSION_TTL_MS } = await import(
  '../stripe-mcp-client.js'
);

// ── Tests ────────────────────────────────────────────────────────────────────

describe('stripe-mcp-client', () => {
  beforeEach(() => {
    _resetStripeMcpClientCache();
    vi.clearAllMocks();
    envMocks.env.NOMAD_ALLOC_DIR = undefined;
    delete process.env.APPS_BASE_DIR;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── No key ─────────────────────────────────────────────────────────────────

  describe('when STRIPE_MCP_KEY is absent', () => {
    it('returns {} and logs no_key', async () => {
      fsMocks.existsSync.mockReturnValue(false);
      const result = await loadStripeMcpTools('app123');
      expect(result).toEqual({});
      expect(mockCreateMCPClient).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        'stripe_mcp_client.no_key',
        expect.objectContaining({ appId: 'app123' }),
      );
    });

    it('returns {} when no appId is provided in local dev mode', async () => {
      const result = await loadStripeMcpTools();
      expect(result).toEqual({});
    });

    it('returns {} when config exists but STRIPE_MCP_KEY value is absent (post-go-live state)', async () => {
      // This is the actual on-disk state after the go-live delete op: config.json
      // is present but no longer carries STRIPE_MCP_KEY. Exercises the
      // `typeof v === 'string' && v` guard that turns a deleted key into "no tools".
      envMocks.env.NOMAD_ALLOC_DIR = undefined;
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(makeConfig({ STRIPE_SECRET_KEY: 'sk_live_only' }));
      process.env.APPS_BASE_DIR = '/test-apps';

      const result = await loadStripeMcpTools('app1');

      expect(result).toEqual({});
      expect(mockCreateMCPClient).not.toHaveBeenCalled();
    });

    it('returns {} when STRIPE_MCP_KEY value is an empty string', async () => {
      envMocks.env.NOMAD_ALLOC_DIR = undefined;
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(makeConfig({ STRIPE_MCP_KEY: '' }));
      process.env.APPS_BASE_DIR = '/test-apps';

      const result = await loadStripeMcpTools('app1');

      expect(result).toEqual({});
      expect(mockCreateMCPClient).not.toHaveBeenCalled();
    });
  });

  // ── Tool passthrough ───────────────────────────────────────────────────────

  describe('tool passthrough', () => {
    it('returns all tools from the MCP server without filtering', async () => {
      const fakeClient = makeFakeClient({
        create_product: { description: 'create a product' },
        create_refund: { description: 'issue a refund' },
        stripe_api_execute: { description: 'exec anything' },
      });
      mockCreateMCPClient.mockResolvedValue(fakeClient);
      setupLocalConfig('app1', 'sk_live_test');

      const tools = await loadStripeMcpTools('app1');

      expect(Object.keys(tools).sort()).toEqual(
        ['create_product', 'create_refund', 'stripe_api_execute'].sort(),
      );
    });

    it('logs tool count and names', async () => {
      const fakeClient = makeFakeClient({ create_product: {}, create_price: {} });
      mockCreateMCPClient.mockResolvedValue(fakeClient);
      setupLocalConfig('app1', 'sk_live_test');

      await loadStripeMcpTools('app1');

      const loadedCall = mockLogger.info.mock.calls.find(([event]) =>
        event === 'stripe_mcp_client.tools_loaded',
      );
      expect(loadedCall).toBeDefined();
      expect(loadedCall![1]).toMatchObject({ toolCount: 2 });
    });
  });

  // ── Execute-layer key guard ──────────────────────────────────────────────────

  describe('execute-layer key guard', () => {
    it('executes normally while the config key is unchanged', async () => {
      const upstreamExecute = vi.fn().mockResolvedValue({ ok: true });
      const fakeClient = makeFakeClient({ create_product: { execute: upstreamExecute } });
      mockCreateMCPClient.mockResolvedValue(fakeClient);
      setupLocalConfig('app1', 'ek_test_key');

      const tools = await loadStripeMcpTools('app1');
      const result = await tools.create_product.execute!({ name: 'T-Shirt' }, {});

      expect(upstreamExecute).toHaveBeenCalledOnce();
      expect(result).toEqual({ ok: true });
    });

    it('refuses when the key was deleted from config after registration (go-live)', async () => {
      const upstreamExecute = vi.fn().mockResolvedValue({ ok: true });
      const fakeClient = makeFakeClient({ create_product: { execute: upstreamExecute } });
      mockCreateMCPClient.mockResolvedValue(fakeClient);
      setupLocalConfig('app1', 'ek_test_key');

      const tools = await loadStripeMcpTools('app1');

      // Simulate go-live: STRIPE_MCP_KEY deleted from config.
      fsMocks.readFileSync.mockReturnValue(makeConfig({}));

      const result = (await tools.create_product.execute!({ name: 'T-Shirt' }, {})) as {
        error?: string;
        message?: string;
      };

      expect(upstreamExecute).not.toHaveBeenCalled();
      expect(result.error).toBe('stripe_mcp_unavailable');
      expect(result.message).toContain('dashboard.stripe.com');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'stripe_mcp_client.tool_blocked_stale_key',
        expect.objectContaining({ appId: 'app1', toolName: 'create_product', reason: 'key_absent' }),
      );
    });

    it('refuses when the key rotated to a different value after registration', async () => {
      const upstreamExecute = vi.fn().mockResolvedValue({ ok: true });
      const fakeClient = makeFakeClient({ create_product: { execute: upstreamExecute } });
      mockCreateMCPClient.mockResolvedValue(fakeClient);
      setupLocalConfig('app1', 'ek_test_key');

      const tools = await loadStripeMcpTools('app1');

      // Key rotated (e.g. new sandbox) — cached session no longer matches config.
      fsMocks.readFileSync.mockReturnValue(makeConfig({ STRIPE_MCP_KEY: 'ek_test_different' }));

      const result = (await tools.create_product.execute!({ name: 'T-Shirt' }, {})) as {
        error?: string;
      };

      expect(upstreamExecute).not.toHaveBeenCalled();
      expect(result.error).toBe('stripe_mcp_unavailable');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'stripe_mcp_client.tool_blocked_stale_key',
        expect.objectContaining({ reason: 'key_rotated' }),
      );
    });
  });

  // ── Caching ────────────────────────────────────────────────────────────────

  describe('caching', () => {
    it('returns cached promise on second call without re-initialising', async () => {
      const fakeClient = makeFakeClient({ create_product: {} });
      mockCreateMCPClient.mockResolvedValue(fakeClient);
      setupLocalConfig('app1', 'sk_live_test');

      await loadStripeMcpTools('app1');
      await loadStripeMcpTools('app1');

      expect(mockCreateMCPClient).toHaveBeenCalledTimes(1);
    });

    it('dedupes concurrent callers to a single createMCPClient (in-flight promise share)', async () => {
      // The design stores the in-flight Promise specifically so two callers
      // racing before the first resolves share one client. Fire both without
      // awaiting in between.
      let resolveClient: (c: ReturnType<typeof makeFakeClient>) => void = () => {};
      mockCreateMCPClient.mockReturnValue(
        new Promise((resolve) => {
          resolveClient = resolve;
        }),
      );
      setupLocalConfig('app1', 'ek_test_key');

      const p1 = loadStripeMcpTools('app1');
      const p2 = loadStripeMcpTools('app1');
      resolveClient(makeFakeClient({ create_product: {} }));
      await Promise.all([p1, p2]);

      expect(mockCreateMCPClient).toHaveBeenCalledTimes(1);
    });

    it('creates a new client for a different key', async () => {
      const client1 = makeFakeClient({ create_product: {} });
      const client2 = makeFakeClient({ create_price: {} });
      mockCreateMCPClient.mockResolvedValueOnce(client1).mockResolvedValueOnce(client2);

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync
        .mockReturnValueOnce(makeConfig({ STRIPE_MCP_KEY: 'ek_test_key1' })) // app1
        .mockReturnValueOnce(makeConfig({ STRIPE_MCP_KEY: 'ek_test_key2' })); // app2
      process.env.APPS_BASE_DIR = '/test-apps';
      envMocks.env.NOMAD_ALLOC_DIR = undefined;

      await loadStripeMcpTools('app1');
      await loadStripeMcpTools('app2'); // different key → new client

      expect(mockCreateMCPClient).toHaveBeenCalledTimes(2);
    });
  });

  // ── TTL eviction ───────────────────────────────────────────────────────────

  describe('session TTL', () => {
    it('evicts and closes the client after TTL expires', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const fakeClient = makeFakeClient({ create_product: {} });
      mockCreateMCPClient.mockResolvedValue(fakeClient);
      setupLocalConfig('app1', 'sk_live_test');

      await loadStripeMcpTools('app1');
      expect(mockCreateMCPClient).toHaveBeenCalledTimes(1);

      // Advance past TTL
      vi.advanceTimersByTime(_MCP_SESSION_TTL_MS + 1);

      await loadStripeMcpTools('app1');

      expect(mockCreateMCPClient).toHaveBeenCalledTimes(2);
      expect(fakeClient.close).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'stripe_mcp_client.session_expired',
        expect.objectContaining({ appId: 'app1' }),
      );
    });

    it('resets TTL on each cache hit (sliding window)', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const fakeClient = makeFakeClient({ create_product: {} });
      mockCreateMCPClient.mockResolvedValue(fakeClient);
      setupLocalConfig('app1', 'sk_live_test');

      await loadStripeMcpTools('app1');

      // Hit the cache just before TTL — should reset the window
      vi.advanceTimersByTime(_MCP_SESSION_TTL_MS - 1000);
      await loadStripeMcpTools('app1');

      // Advance another TTL - 1s from the reset point — still within window
      vi.advanceTimersByTime(_MCP_SESSION_TTL_MS - 1000);
      await loadStripeMcpTools('app1');

      // Client should not have been recreated
      expect(mockCreateMCPClient).toHaveBeenCalledTimes(1);
      expect(fakeClient.close).not.toHaveBeenCalled();
    });
  });

  // ── Error path ─────────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('clears cache and logs on createMCPClient failure', async () => {
      mockCreateMCPClient.mockRejectedValue(new Error('network error'));
      setupLocalConfig('app1', 'sk_live_test');

      const result = await loadStripeMcpTools('app1');

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        'stripe_mcp_client.init_failed',
        expect.objectContaining({ error: 'network error' }),
      );

      // Cache cleared — second call should re-attempt
      mockCreateMCPClient.mockResolvedValue(makeFakeClient({ create_product: {} }));
      await loadStripeMcpTools('app1');
      expect(mockCreateMCPClient).toHaveBeenCalledTimes(2);
    });

    it('calls close on the client when tools() throws', async () => {
      const fakeClient = {
        tools: vi.fn().mockRejectedValue(new Error('tools failed')),
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateMCPClient.mockResolvedValue(fakeClient);
      setupLocalConfig('app1', 'sk_live_test');

      const result = await loadStripeMcpTools('app1');

      expect(result).toEqual({});
      expect(fakeClient.close).toHaveBeenCalledTimes(1);
    });
  });

  // ── Production (Nomad) path ────────────────────────────────────────────────

  describe('Nomad production path', () => {
    it('reads STRIPE_MCP_KEY from NOMAD_ALLOC_DIR/config.json and uses it as the bearer token', async () => {
      envMocks.env.NOMAD_ALLOC_DIR = '/alloc';
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(makeConfig({ STRIPE_MCP_KEY: 'ek_test_nomad_abc' }));
      const fakeClient = makeFakeClient({ create_product: {} });
      mockCreateMCPClient.mockResolvedValue(fakeClient);

      const tools = await loadStripeMcpTools(); // no appId needed in prod

      expect(tools).toHaveProperty('create_product');
      // Confirm the key from STRIPE_MCP_KEY (not STRIPE_SECRET_KEY) is used —
      // STRIPE_SECRET_KEY is variant-scoped to preview/publish and is absent
      // from the agent task's alloc config.json.
      expect(mockCreateMCPClient).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            headers: { Authorization: 'Bearer ek_test_nomad_abc' },
          }),
        }),
      );
    });

    it('uses STRIPE_MCP_KEY as bearer token in local dev path', async () => {
      const fakeClient = makeFakeClient({ create_product: {} });
      mockCreateMCPClient.mockResolvedValue(fakeClient);
      setupLocalConfig('app1', 'ek_test_local_xyz');

      await loadStripeMcpTools('app1');

      expect(mockCreateMCPClient).toHaveBeenCalledWith(
        expect.objectContaining({
          transport: expect.objectContaining({
            headers: { Authorization: 'Bearer ek_test_local_xyz' },
          }),
        }),
      );
    });

    it('logs error when Nomad config.json cannot be parsed', async () => {
      envMocks.env.NOMAD_ALLOC_DIR = '/alloc';
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockImplementation(() => { throw new Error('read error'); });

      const result = await loadStripeMcpTools();

      expect(result).toEqual({});
      expect(mockLogger.error).toHaveBeenCalledWith(
        'stripe_mcp_client.config_read_failed',
        expect.objectContaining({ error: 'read error' }),
      );
    });

    it('returns {} when alloc config.json does not exist', async () => {
      envMocks.env.NOMAD_ALLOC_DIR = '/alloc';
      fsMocks.existsSync.mockReturnValue(false);

      const result = await loadStripeMcpTools();

      expect(result).toEqual({});
      expect(mockCreateMCPClient).not.toHaveBeenCalled();
    });
  });

  // ── Path traversal guard ───────────────────────────────────────────────────

  describe('path traversal guard', () => {
    it('rejects appIds containing ..', async () => {
      const result = await loadStripeMcpTools('../../../etc/passwd');
      expect(result).toEqual({});
      expect(mockCreateMCPClient).not.toHaveBeenCalled();
    });

    it('rejects appIds containing /', async () => {
      const result = await loadStripeMcpTools('foo/bar');
      expect(result).toEqual({});
      expect(mockCreateMCPClient).not.toHaveBeenCalled();
    });
  });
});
