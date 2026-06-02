import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock dependencies ---

vi.mock('../../../../logging/index.js', () => ({
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const mockMemoryGet = vi.fn();
const mockMemorySet = vi.fn();
vi.mock('../../../../database/repositories/MemoryRepository.js', () => ({
  MemoryRepository: vi.fn().mockImplementation(function () { return {
    get: mockMemoryGet,
    set: mockMemorySet,
  }; }),
}));

const mockFindById = vi.fn();
vi.mock('../../../../database/repositories/index.js', () => ({
  appRepository: { findById: mockFindById },
}));

const mockGetActionService = vi.fn();
vi.mock('../../../../server/agent-runtime.js', () => ({
  getActionService: (...args: unknown[]) => mockGetActionService(...args),
}));

const mockInstallTemplates = vi.fn();
vi.mock('../../../../tools/skill-loader-tool.js', () => ({
  SkillLoaderTool: vi.fn().mockImplementation(function () { return {
    installTemplates: mockInstallTemplates,
  }; }),
}));

const mockListAccounts = vi.fn();
const mockActivateAccount = vi.fn();
const mockListEmbeddables = vi.fn();
const mockCreateEmbeddable = vi.fn();
const mockUpdateEmbeddable = vi.fn();
vi.mock('../reamaze.js', () => ({
  listAccounts: (...args: unknown[]) => mockListAccounts(...args),
  activateAccount: (...args: unknown[]) => mockActivateAccount(...args),
  listEmbeddables: (...args: unknown[]) => mockListEmbeddables(...args),
  createEmbeddable: (...args: unknown[]) => mockCreateEmbeddable(...args),
  updateEmbeddable: (...args: unknown[]) => mockUpdateEmbeddable(...args),
}));

const mockAccess = vi.fn();
vi.mock('fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}));

const mockReadWidgetConfig = vi.fn();
const mockWriteWidgetConfig = vi.fn();
vi.mock('../widget-config.js', () => ({
  readWidgetConfig: (...args: unknown[]) => mockReadWidgetConfig(...args),
  writeWidgetConfig: (...args: unknown[]) => mockWriteWidgetConfig(...args),
}));

const { discoverAccountTool, selectAccountTool, setupWidgetTool, updateWidgetConfigTool } =
  await import('../index.js');

// --- Test helpers ---

const context = { metadata: { appId: 'app-123' }, socketId: 'socket-1' };
const mockClient = {} as any;

describe('inbox skill tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActionService.mockReturnValue(mockClient);
    mockFindById.mockResolvedValue({ path: '/tmp/airo-app-builder/app-123/preview', name: 'My App' });
    mockInstallTemplates.mockResolvedValue({ success: true });
    mockAccess.mockResolvedValue(undefined);
    mockReadWidgetConfig.mockResolvedValue({
      _support: { account: '', ui: { widget: { icon: 'webChat', color: '', position: 'bottom-right' } } },
    });
    mockWriteWidgetConfig.mockResolvedValue(undefined);
  });

  // --------------------------------------------------------------------------
  // discover_account
  // --------------------------------------------------------------------------

  describe('discover_account', () => {
    it('has correct tool definition', () => {
      expect(discoverAccountTool.name).toBe('discover_account');
      expect(discoverAccountTool.execute).toBeTypeOf('function');
    });

    it('returns error when appId is missing', async () => {
      const result = await discoverAccountTool.execute({}, {});
      expect(result.error).toContain('App ID required');
    });

    it('returns alreadyConfigured when brand exists in memory', async () => {
      mockMemoryGet.mockResolvedValue({ exists: true, value: 'a1b2c3d4-0000-4000-8000-000000000001' });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.alreadyConfigured).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000001');
    });

    it('returns error when no client action service is available', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });
      mockGetActionService.mockReturnValue(null);

      const result = await discoverAccountTool.execute({}, context);

      expect(result.error).toContain('ClientActionService not available');
    });

    it('auto-links account when listAccounts returns one matching current appId', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });
      mockListAccounts.mockResolvedValue({
        success: true,
        data: {
          accounts: [
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000001', name: 'My Account', ventureId: 'v1', aabAppId: 'app-123' },
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Other', ventureId: 'v2', aabAppId: 'other-app' },
          ],
          unlinkedEntitlements: [],
        },
      });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.alreadyConfigured).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000001');
      expect(mockMemorySet).toHaveBeenCalledWith(
        'app-123',
        'integrations.inbox.brandId',
        'a1b2c3d4-0000-4000-8000-000000000001',
      );
    });

    it('auto-creates account when no matching account exists but entitlements are available', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });
      mockListAccounts.mockResolvedValue({
        success: true,
        data: {
          accounts: [
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000002', name: 'Other', ventureId: 'v2', aabAppId: 'other-app' },
          ],
          unlinkedEntitlements: [
            { entitlementId: 'ent-1', name: 'Basic Plan', plan: 'basic', createdAt: '2025-01-01' },
          ],
        },
      });
      mockActivateAccount.mockResolvedValue({
        success: true,
        data: { name: 'New Account', brandUrl: 'a1b2c3d4-0000-4000-8000-000000000003', ventureId: 'v3', aabAppId: 'app-123' },
      });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.accountCreated).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000003');
      expect(mockActivateAccount).toHaveBeenCalledWith(mockClient, 'app-123', 'ent-1', 'My App');
      expect(mockMemorySet).toHaveBeenCalledWith(
        'app-123',
        'integrations.inbox.brandId',
        'a1b2c3d4-0000-4000-8000-000000000003',
      );
    });

    it('returns error when account activation fails during auto-create', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });
      mockListAccounts.mockResolvedValue({
        success: true,
        data: {
          accounts: [],
          unlinkedEntitlements: [
            { entitlementId: 'ent-1', name: 'Basic Plan', plan: 'basic', createdAt: '2025-01-01' },
          ],
        },
      });
      mockActivateAccount.mockResolvedValue({ success: false, error: 'Activation failed' });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.error).toContain('Activation failed');
    });

    it('auto-creates when accounts exist but none match this app', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });
      mockListAccounts.mockResolvedValue({
        success: true,
        data: {
          accounts: [
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000004', name: 'Free Account', ventureId: 'v1', aabAppId: null },
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000005', name: 'Linked', ventureId: 'v2', aabAppId: 'other-app' },
          ],
          unlinkedEntitlements: [
            { entitlementId: 'ent-1', name: 'Basic Plan', plan: 'basic', createdAt: '2025-01-01' },
          ],
        },
      });
      mockActivateAccount.mockResolvedValue({
        success: true,
        data: { name: 'New Account', brandUrl: 'a1b2c3d4-0000-4000-8000-000000000003', ventureId: 'v3', aabAppId: 'app-123' },
      });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.accountCreated).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000003');
    });

    it('returns noAccounts when no accounts and no entitlements', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });
      mockListAccounts.mockResolvedValue({
        success: true,
        data: { accounts: [], unlinkedEntitlements: [] },
      });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.noAccounts).toBe(true);
    });

    it('returns error when listAccounts fails', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });
      mockListAccounts.mockResolvedValue({ success: false, error: 'Timeout' });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.error).toContain('Timeout');
    });
  });

  // --------------------------------------------------------------------------
  // select_account
  // --------------------------------------------------------------------------

  describe('select_account', () => {
    it('persists existing account URL to memory', async () => {
      const result = await selectAccountTool.execute(
        { accountUrl: 'a1b2c3d4-0000-4000-8000-000000000001' },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000001');
      expect(mockMemorySet).toHaveBeenCalledWith(
        'app-123',
        'integrations.inbox.brandId',
        'a1b2c3d4-0000-4000-8000-000000000001',
      );
    });

    it('activates account for create_new without entitlementId', async () => {
      mockActivateAccount.mockResolvedValue({
        success: true,
        data: { name: 'New Account', brandUrl: 'a1b2c3d4-0000-4000-8000-000000000003', ventureId: 'v1', aabAppId: 'app-123' },
      });

      const result = await selectAccountTool.execute(
        { accountUrl: 'create_new' },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000003');
      expect(mockActivateAccount).toHaveBeenCalledWith(expect.anything(), 'app-123', undefined, 'My App');
    });

    it('activates account for create_new with entitlementId', async () => {
      mockActivateAccount.mockResolvedValue({
        success: true,
        data: { name: 'New Account', brandUrl: 'a1b2c3d4-0000-4000-8000-000000000003', ventureId: 'v1', aabAppId: 'app-123' },
      });

      const result = await selectAccountTool.execute(
        { accountUrl: 'create_new', entitlementId: 'ent-1' },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000003');
      expect(result.activated).toBe(true);
      expect(mockMemorySet).toHaveBeenCalledWith(
        'app-123',
        'integrations.inbox.brandId',
        'a1b2c3d4-0000-4000-8000-000000000003',
      );
    });

    it('returns error when activation fails', async () => {
      mockActivateAccount.mockResolvedValue({
        success: false,
        error: 'Entitlement already used',
      });

      const result = await selectAccountTool.execute(
        { accountUrl: 'create_new', entitlementId: 'ent-1' },
        context,
      );

      expect(result.error).toContain('Entitlement already used');
    });

    it('returns error when no client for create_new', async () => {
      mockGetActionService.mockReturnValue(null);

      const result = await selectAccountTool.execute(
        { accountUrl: 'create_new', entitlementId: 'ent-1' },
        context,
      );

      expect(result.error).toContain('ClientActionService not available');
    });
  });

  // --------------------------------------------------------------------------
  // setup_widget
  // --------------------------------------------------------------------------

  describe('setup_widget', () => {
    beforeEach(() => {
      mockMemoryGet.mockImplementation(function (_appId: string, key: string) {
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'a1b2c3d4-0000-4000-8000-000000000001' });
        }
        if (key === 'integrations.inbox.embeddableId') {
          return Promise.resolve({ exists: false });
        }
        return Promise.resolve({ exists: false });
      });
      mockListEmbeddables.mockResolvedValue({
        success: true,
        data: [{ id: 10, title: 'Existing Widget' }],
      });
      mockUpdateEmbeddable.mockResolvedValue({
        success: true,
        data: { id: 10 },
      });
    });

    it('returns error when appId is missing', async () => {
      const result = await setupWidgetTool.execute({}, {});
      expect(result.error).toContain('App ID required');
    });

    it('returns error when app path cannot be resolved', async () => {
      mockFindById.mockResolvedValue(null);
      const result = await setupWidgetTool.execute({}, context);
      expect(result.error).toContain('Could not resolve app path');
    });

    it('returns brandNotProvisioned when brand is not in memory', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });

      const result = await setupWidgetTool.execute({}, context);

      expect(result.brandNotProvisioned).toBe(true);
    });

    it('auto-installs template when InboxChatWidget.tsx is missing', async () => {
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      await setupWidgetTool.execute({}, context);

      expect(mockInstallTemplates).toHaveBeenCalledWith({
        skill: 'inbox',
        appPath: '/tmp/airo-app-builder/app-123/preview',
        appId: 'app-123',
      });
    });

    it('returns error when template auto-install fails', async () => {
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockInstallTemplates.mockResolvedValue({ success: false, error: 'disk full' });

      const result = await setupWidgetTool.execute({}, context);

      expect(result.error).toContain('Failed to auto-install');
    });

    it('does not install template when widget already exists', async () => {
      mockAccess.mockResolvedValue(undefined);

      await setupWidgetTool.execute({}, context);

      expect(mockInstallTemplates).not.toHaveBeenCalled();
    });

    it('reuses cached embeddable from memory', async () => {
      mockMemoryGet.mockImplementation(function (_appId: string, key: string) {
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'a1b2c3d4-0000-4000-8000-000000000001' });
        }
        if (key === 'integrations.inbox.embeddableId') {
          return Promise.resolve({ exists: true, value: 42 });
        }
        return Promise.resolve({ exists: false });
      });
      mockUpdateEmbeddable.mockResolvedValue({ success: true, data: { id: 42 } });

      const result = await setupWidgetTool.execute({}, context);

      expect(mockListEmbeddables).not.toHaveBeenCalled();
      expect(mockCreateEmbeddable).not.toHaveBeenCalled();
      expect(result.embeddableId).toBe(42);
    });

    it('uses first existing embeddable when not cached', async () => {
      const result = await setupWidgetTool.execute({}, context);

      expect(result.embeddableId).toBe(10);
      expect(mockCreateEmbeddable).not.toHaveBeenCalled();
      expect(mockMemorySet).toHaveBeenCalledWith(
        'app-123',
        'integrations.inbox.embeddableId',
        10,
      );
    });

    it('creates embeddable when none exist', async () => {
      mockListEmbeddables.mockResolvedValue({ success: true, data: [] });
      mockCreateEmbeddable.mockResolvedValue({
        success: true,
        data: { id: 99, title: 'Chat Widget' },
      });

      const result = await setupWidgetTool.execute(
        { color: '#1e40af' },
        context,
      );

      expect(mockCreateEmbeddable).toHaveBeenCalledWith(
        mockClient,
        'app-123',
        'a1b2c3d4-0000-4000-8000-000000000001',
        expect.objectContaining({
          title: 'My App',
          shoutbox_icon: 'webChat',
          shoutbox_bg: '#1e40af',
          styles: { button_bg_color: '#1e40af', header_bg_color: '#1e40af' },
        }),
      );
      expect(result.embeddableId).toBe(99);
    });

    it('returns error when listEmbeddables fails', async () => {
      mockListEmbeddables.mockResolvedValue({ success: false, error: 'unauthorized' });

      const result = await setupWidgetTool.execute({}, context);

      expect(result.error).toContain('unauthorized');
    });

    it('returns error when createEmbeddable fails', async () => {
      mockListEmbeddables.mockResolvedValue({ success: true, data: [] });
      mockCreateEmbeddable.mockResolvedValue({ success: false, error: 'quota exceeded' });

      const result = await setupWidgetTool.execute({}, context);

      expect(result.error).toContain('quota exceeded');
    });

    it('returns error when updateEmbeddable fails', async () => {
      mockUpdateEmbeddable.mockResolvedValue({ success: false, error: 'server error' });

      const result = await setupWidgetTool.execute({}, context);

      expect(result.error).toContain('server error');
    });

    it('returns brandId and writes config file', async () => {
      const result = await setupWidgetTool.execute({}, context);

      expect(result.brandId).toBe('a1b2c3d4-0000-4000-8000-000000000001');
      expect(result.configWritten).toContain('inboxChat.config.json');
      expect(mockWriteWidgetConfig).toHaveBeenCalledWith(
        expect.stringContaining('inboxChat.config.json'),
        expect.objectContaining({
          _support: expect.objectContaining({ account: 'a1b2c3d4-0000-4000-8000-000000000001' }),
        }),
      );
    });

    it('writes color to config when provided', async () => {
      const result = await setupWidgetTool.execute({ color: '#aabbcc' }, context);

      expect(result.NEXT_STEP).toContain('InboxChatWidget');
      expect(mockWriteWidgetConfig).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          _support: expect.objectContaining({
            ui: { widget: { icon: 'webChat', color: '#aabbcc', position: 'bottom-right' } },
          }),
        }),
      );
    });

    it('returns error when client is unavailable', async () => {
      mockGetActionService.mockReturnValue(null);

      const result = await setupWidgetTool.execute({}, context);

      expect(result.error).toContain('ClientActionService not available');
    });
  });

  // --------------------------------------------------------------------------
  // update_widget_config
  // --------------------------------------------------------------------------

  describe('update_widget_config', () => {
    beforeEach(() => {
      mockMemoryGet.mockImplementation(function (_appId: string, key: string) {
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'a1b2c3d4-0000-4000-8000-000000000001' });
        }
        if (key === 'integrations.inbox.embeddableId') {
          return Promise.resolve({ exists: true, value: 42 });
        }
        return Promise.resolve({ exists: false });
      });
      mockUpdateEmbeddable.mockResolvedValue({ success: true, data: { id: 42 } });
    });

    it('returns error when appId is missing', async () => {
      const result = await updateWidgetConfigTool.execute({}, {});
      expect(result.error).toContain('App ID required');
    });

    it('returns error when brand or embeddable missing from memory', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });

      const result = await updateWidgetConfigTool.execute({ color: '#ff0000' }, context);

      expect(result.error).toContain('Run inbox__setup_widget first');
    });

    it('returns message when no fields provided', async () => {
      const result = await updateWidgetConfigTool.execute({}, context);

      expect(result.message).toContain('No fields provided');
      expect(mockUpdateEmbeddable).not.toHaveBeenCalled();
    });

    it('patches embeddable with color', async () => {
      const result = await updateWidgetConfigTool.execute({ color: '#ff0000' }, context);

      expect(mockUpdateEmbeddable).toHaveBeenCalledWith(
        mockClient,
        'app-123',
        'a1b2c3d4-0000-4000-8000-000000000001',
        42,
        {
          styles: { button_bg_color: '#ff0000', header_bg_color: '#ff0000' },
          shoutbox_bg: '#ff0000',
        },
      );
      expect(result.brandId).toBe('a1b2c3d4-0000-4000-8000-000000000001');
      expect(result.embeddableId).toBe(42);
    });

    it('patches embeddable with position', async () => {
      await updateWidgetConfigTool.execute({ position: 'bottom-left' }, context);

      expect(mockUpdateEmbeddable).toHaveBeenCalledWith(
        mockClient,
        'app-123',
        'a1b2c3d4-0000-4000-8000-000000000001',
        42,
        { shoutbox_position: 'bottom-left' },
      );
    });

    it('patches embeddable with labelText and writes label to config', async () => {
      mockReadWidgetConfig.mockResolvedValue({
        _support: { account: '', ui: { widget: { icon: 'webChat', color: '', position: 'bottom-right' } } },
      });

      await updateWidgetConfigTool.execute({ labelText: 'Chat with us!' }, context);

      expect(mockUpdateEmbeddable).toHaveBeenCalledWith(
        mockClient,
        'app-123',
        'a1b2c3d4-0000-4000-8000-000000000001',
        42,
        { shoutbox_label: 'Chat with us!' },
      );
      expect(mockWriteWidgetConfig).toHaveBeenCalledWith(
        expect.stringContaining('inboxChat.config.json'),
        expect.objectContaining({
          _support: expect.objectContaining({
            account: 'a1b2c3d4-0000-4000-8000-000000000001',
            ui: { widget: { icon: 'webChat', color: '', position: 'bottom-right', label: { text: 'Chat with us!' } } },
          }),
        }),
      );
    });

    it('writes config file with account restored after successful backend sync', async () => {
      mockReadWidgetConfig.mockResolvedValue({
        _support: { account: '', ui: { widget: { icon: 'webChat', color: '', position: 'bottom-right' } } },
      });

      await updateWidgetConfigTool.execute({ color: '#ff0000', position: 'bottom-left' }, context);

      expect(mockWriteWidgetConfig).toHaveBeenCalledWith(
        expect.stringContaining('inboxChat.config.json'),
        expect.objectContaining({
          _support: expect.objectContaining({
            account: 'a1b2c3d4-0000-4000-8000-000000000001',
            ui: { widget: { icon: 'webChat', color: '#ff0000', position: 'bottom-left' } },
          }),
        }),
      );
    });

    it('does not write config file when backend sync fails', async () => {
      mockUpdateEmbeddable.mockResolvedValue({ success: false, error: 'rate limited' });

      await updateWidgetConfigTool.execute({ color: '#aabbcc' }, context);

      expect(mockWriteWidgetConfig).not.toHaveBeenCalled();
    });

    it('returns error when updateEmbeddable fails', async () => {
      mockUpdateEmbeddable.mockResolvedValue({ success: false, error: 'rate limited' });

      const result = await updateWidgetConfigTool.execute({ color: '#aabbcc' }, context);

      expect(result.error).toContain('rate limited');
    });

    it('returns error when client is unavailable', async () => {
      mockGetActionService.mockReturnValue(null);

      const result = await updateWidgetConfigTool.execute({ color: '#aabbcc' }, context);

      expect(result.error).toContain('ClientActionService not available');
    });
  });
});
