import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@airo/ai-lib', () => ({
  getS2SToken: vi.fn().mockResolvedValue('s2s-token-123'),
  isS2SAuthEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('../asm-client.js', () => ({
  AsmClient: vi.fn().mockImplementation((opts: { baseUrl: string; getAuthToken: () => Promise<string> }) => ({
    _opts: opts,
    getAuthToken: opts.getAuthToken,
  })),
}));

vi.mock('../asm-conversation-store.js', () => ({
  AsmConversationLifecycleStore: vi.fn().mockImplementation((_client: unknown, _serviceId: string) => ({
    _type: 'lifecycle',
  })),
}));

vi.mock('../asm-message-store.js', () => ({
  AsmMessageStore: vi.fn().mockImplementation(() => ({
    _type: 'message',
    registerMessageAddedHook: vi.fn(),
  })),
}));

vi.mock('../asm-token-store.js', () => ({
  AsmConversationTokenStore: vi.fn().mockImplementation(() => ({
    _type: 'token',
    recordMessageTimestamp: vi.fn(),
  })),
}));

describe('asm/index auth wiring', function asmIndexTests() {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(function setup() {
    originalEnv = { ...process.env };
    process.env.ASM_BASE_URL = 'https://asm.example.com';
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(function teardown() {
    process.env = originalEnv;
  });

  it('should throw if ASM_BASE_URL is not set', async function missingBaseUrl() {
    delete process.env.ASM_BASE_URL;
    const { getAsmConversationLifecycleStore } = await import('../index.js');
    expect(() => getAsmConversationLifecycleStore()).toThrow('ASM_BASE_URL');
  });

  it('should use S2S token when S2S auth is enabled', async function s2sAuth() {
    const { isS2SAuthEnabled, getS2SToken } = await import('@airo/ai-lib');
    vi.mocked(isS2SAuthEnabled).mockReturnValue(true);
    vi.mocked(getS2SToken).mockResolvedValue('s2s-token-456');

    const { getAsmConversationLifecycleStore } = await import('../index.js');
    getAsmConversationLifecycleStore();

    const { AsmClient } = await import('../asm-client.js');
    const clientCall = vi.mocked(AsmClient).mock.calls[0]![0] as { getAuthToken: () => Promise<string> };
    const token = await clientCall.getAuthToken();
    expect(token).toBe('s2s-token-456');
  });

  it('should fall back to SSO_JWT when S2S is disabled', async function ssoJwtFallback() {
    process.env.SSO_JWT = 'sso-jwt-789';
    const { isS2SAuthEnabled } = await import('@airo/ai-lib');
    vi.mocked(isS2SAuthEnabled).mockReturnValue(false);

    const { getAsmConversationLifecycleStore } = await import('../index.js');
    getAsmConversationLifecycleStore();

    const { AsmClient } = await import('../asm-client.js');
    const clientCall = vi.mocked(AsmClient).mock.calls[0]![0] as { getAuthToken: () => Promise<string> };
    const token = await clientCall.getAuthToken();
    expect(token).toBe('sso-jwt-789');
  });

  it('should throw when neither S2S nor SSO_JWT is configured', async function noAuth() {
    delete process.env.SSO_JWT;
    const { isS2SAuthEnabled } = await import('@airo/ai-lib');
    vi.mocked(isS2SAuthEnabled).mockReturnValue(false);

    const { getAsmConversationLifecycleStore } = await import('../index.js');
    getAsmConversationLifecycleStore();

    const { AsmClient } = await import('../asm-client.js');
    const clientCall = vi.mocked(AsmClient).mock.calls[0]![0] as { getAuthToken: () => Promise<string> };
    await expect(clientCall.getAuthToken()).rejects.toThrow('No ASM authentication configured');
  });

  it('should wire messageAdded hook from message store to token store', async function hookWiring() {
    const { getAsmMessageStore } = await import('../index.js');
    const msgStore = getAsmMessageStore() as unknown as { registerMessageAddedHook: ReturnType<typeof vi.fn> };
    expect(msgStore.registerMessageAddedHook).toHaveBeenCalledTimes(1);

    const hookFn = msgStore.registerMessageAddedHook.mock.calls[0]![0] as (msg: { createdAt: Date }) => void;
    const { AsmConversationTokenStore } = await import('../asm-token-store.js');
    const tokenStoreInstance = vi.mocked(AsmConversationTokenStore).mock.results[0]!.value as { recordMessageTimestamp: ReturnType<typeof vi.fn> };

    const testDate = new Date('2024-06-15T12:00:00Z');
    hookFn({ createdAt: testDate });
    expect(tokenStoreInstance.recordMessageTimestamp).toHaveBeenCalledWith(testDate);
  });

  it('should use ASM_SERVICE_ID env var for lifecycle store', async function serviceId() {
    process.env.ASM_SERVICE_ID = 'custom-service';
    const { getAsmConversationLifecycleStore } = await import('../index.js');
    getAsmConversationLifecycleStore();

    const { AsmConversationLifecycleStore } = await import('../asm-conversation-store.js');
    expect(vi.mocked(AsmConversationLifecycleStore).mock.calls[0]![1]).toBe('custom-service');
  });

  it('should default service ID to airo-agents', async function defaultServiceId() {
    delete process.env.ASM_SERVICE_ID;
    const { getAsmConversationLifecycleStore } = await import('../index.js');
    getAsmConversationLifecycleStore();

    const { AsmConversationLifecycleStore } = await import('../asm-conversation-store.js');
    expect(vi.mocked(AsmConversationLifecycleStore).mock.calls[0]![1]).toBe('airo-agents');
  });
});
