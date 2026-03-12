import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockWithCommerceAuth = vi.fn();
const mockGetNomadAllocConfig = vi.fn();
const mockFindById = vi.fn();

vi.mock('fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

vi.mock('../../../../utils/nomad-config.js', () => ({
  getNomadAllocConfig: mockGetNomadAllocConfig,
}));

vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: {
    findById: mockFindById,
  },
}));

vi.mock('../../../../lib/godaddy-commerce.js', () => ({
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../auth.js', () => ({
  withCommerceAuth: mockWithCommerceAuth,
}));

const { installStorefrontTool } = await import('../index.js');

describe('commerce__install_storefront', () => {
  const context = { metadata: { appId: 'app-123' } };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com';
    process.env.GODADDY_OAUTH_CLIENT_ID = 'env-client-id';
    mockReadFile.mockResolvedValue('EXISTING_VAR=foo\n');
    mockWriteFile.mockResolvedValue(undefined);
    mockFindById.mockResolvedValue({ path: '/tmp/airo-app-builder/site-1/preview' });
  });

  it('should have correct tool definition shape', () => {
    expect(installStorefrontTool.name).toBe('install_storefront');
    expect(installStorefrontTool.description).toBeTruthy();
    expect(installStorefrontTool.parameters).toBeDefined();
    expect(installStorefrontTool.execute).toBeTypeOf('function');
  });

  it('should write VITE_ env vars to app .env file', async () => {
    mockGetNomadAllocConfig.mockReturnValue({
      GODADDY_OAUTH_CLIENT_ID: { VALUE: 'alloc-client-id' },
    });

    const result = await installStorefrontTool.execute(
      { storeId: 'store-1', channelId: 'ch-1' },
      context,
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('VITE_GODADDY_CLIENT_ID=alloc-client-id'),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('VITE_GODADDY_API_HOST=api.dev-godaddy.com'),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('VITE_GODADDY_STORE_ID=store-1'),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('VITE_GODADDY_CHANNEL_ID=ch-1'),
    );
    expect(result.envVarsWritten).toContain('VITE_GODADDY_CLIENT_ID');
    expect(result.envVarsWritten).toContain('VITE_GODADDY_API_HOST');
    expect(result.envVarsWritten).toContain('VITE_GODADDY_STORE_ID');
    expect(result.envVarsWritten).toContain('VITE_GODADDY_CHANNEL_ID');
  });

  it('should read client ID from alloc config first, env second', async () => {
    mockGetNomadAllocConfig.mockReturnValue(null);

    const result = await installStorefrontTool.execute(
      { storeId: 'store-1', channelId: 'ch-1' },
      context,
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('VITE_GODADDY_CLIENT_ID=env-client-id'),
    );
    expect(result.envVarsWritten).toContain('VITE_GODADDY_CLIENT_ID');
  });

  it('should strip protocol from GODADDY_API_BASE_URL for API host', async () => {
    process.env.GODADDY_API_BASE_URL = 'https://api.godaddy.com';
    mockGetNomadAllocConfig.mockReturnValue(null);

    await installStorefrontTool.execute(
      { storeId: 'store-1', channelId: 'ch-1' },
      context,
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('VITE_GODADDY_API_HOST=api.godaddy.com'),
    );
  });

  it('should upsert existing env vars instead of duplicating', async () => {
    mockReadFile.mockResolvedValue('VITE_GODADDY_CLIENT_ID=old-value\nOTHER=keep\n');
    mockGetNomadAllocConfig.mockReturnValue({
      GODADDY_OAUTH_CLIENT_ID: { VALUE: 'new-value' },
    });

    await installStorefrontTool.execute(
      { storeId: 'store-1', channelId: 'ch-1' },
      context,
    );

    const writtenContent = mockWriteFile.mock.calls[0][1] as string;
    // Should replace the old value, not append a duplicate
    expect(writtenContent).toContain('VITE_GODADDY_CLIENT_ID=new-value');
    expect(writtenContent).toContain('OTHER=keep');
    expect(writtenContent.match(/VITE_GODADDY_CLIENT_ID/g)?.length).toBe(1);
  });

  it('should return storeId and channelId in result', async () => {
    mockGetNomadAllocConfig.mockReturnValue(null);

    const result = await installStorefrontTool.execute(
      { storeId: 'store-1', channelId: 'ch-1' },
      context,
    );

    expect(result.storeId).toBe('store-1');
    expect(result.channelId).toBe('ch-1');
  });

  it('should fail if appId is missing', async () => {
    const result = await installStorefrontTool.execute(
      { storeId: 'store-1', channelId: 'ch-1' },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });
});
