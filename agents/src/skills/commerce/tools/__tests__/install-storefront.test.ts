import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockWithCommerceAuth = vi.fn();
const mockGetNomadAllocConfig = vi.fn();
const mockFindById = vi.fn();
const mockRestartServer = vi.fn();

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
  GoDaddyCommerce: vi.fn().mockImplementation(() => ({
    getStoreManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/store/store-1'),
    getOrdersManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/orders'),
    getCatalogManagementUrl: vi.fn().mockReturnValue('https://manage.godaddy.com/catalog'),
  })),
}));

vi.mock('../auth.js', () => ({
  withCommerceAuth: mockWithCommerceAuth,
}));

vi.mock('../../../../tools/server-management-tool.js', () => ({
  ServerManagementTool: vi.fn().mockImplementation(() => ({
    restartServer: mockRestartServer,
  })),
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
    mockRestartServer.mockResolvedValue({ success: true, message: 'Server restarted successfully' });
  });

  it('should have correct tool definition shape', () => {
    expect(installStorefrontTool.name).toBe('install_storefront');
    expect(installStorefrontTool.description).toBeTruthy();
    expect(installStorefrontTool.parameters).toBeDefined();
    expect(installStorefrontTool.execute).toBeTypeOf('function');
  });

  it('should write storefront env vars to app .env file', async () => {
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
      expect.stringContaining('GODADDY_API_BASE_URL=https://api.dev-godaddy.com'),
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
    expect(result.envVarsWritten).toContain('GODADDY_API_BASE_URL');
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
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('GODADDY_API_BASE_URL=https://api.godaddy.com'),
    );
  });

  it('should add https protocol when GODADDY_API_BASE_URL is host-only', async () => {
    process.env.GODADDY_API_BASE_URL = 'api.godaddy.com';
    mockGetNomadAllocConfig.mockReturnValue(null);

    await installStorefrontTool.execute(
      { storeId: 'store-1', channelId: 'ch-1' },
      context,
    );

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('.env'),
      expect.stringContaining('GODADDY_API_BASE_URL=https://api.godaddy.com'),
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

  it('should restart the app server after writing storefront env vars', async () => {
    mockGetNomadAllocConfig.mockReturnValue(null);

    const result = await installStorefrontTool.execute(
      { storeId: 'store-1', channelId: 'ch-1' },
      context,
    );

    expect(mockRestartServer).toHaveBeenCalledWith(
      { reason: 'commerce__install_storefront updated Commerce env vars' },
      'app-123',
    );
    expect(result.serverRestarted).toBe(true);
  });

  it('should return restart errors without failing env wiring', async () => {
    mockGetNomadAllocConfig.mockReturnValue(null);
    mockRestartServer.mockResolvedValue({
      success: false,
      message: 'Failed to restart server',
      error: 'Dev supervisor not available for this app',
    });

    const result = await installStorefrontTool.execute(
      { storeId: 'store-1', channelId: 'ch-1' },
      context,
    );

    expect(result.storeId).toBe('store-1');
    expect(result.channelId).toBe('ch-1');
    expect(result.serverRestarted).toBe(false);
    expect(result.serverRestartError).toBe('Dev supervisor not available for this app');
  });

  it('should fail if appId is missing', async () => {
    const result = await installStorefrontTool.execute(
      { storeId: 'store-1', channelId: 'ch-1' },
      { metadata: {} },
    );

    expect(result.error).toBeTruthy();
  });
});
