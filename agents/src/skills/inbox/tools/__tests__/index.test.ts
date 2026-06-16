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


const mockListAccounts = vi.fn();
const mockActivateAccount = vi.fn();
const mockListEmbeddables = vi.fn();
const mockCreateEmbeddable = vi.fn();
const mockUpdateEmbeddable = vi.fn();
const mockListCategories = vi.fn();
const mockCreateCategory = vi.fn();
const mockGetStaff = vi.fn();
const mockUpdateStaff = vi.fn();
vi.mock('../../../../services/inbox-client.js', () => ({
  listAccounts: (...args: unknown[]) => mockListAccounts(...args),
  activateAccount: (...args: unknown[]) => mockActivateAccount(...args),
  listEmbeddables: (...args: unknown[]) => mockListEmbeddables(...args),
  createEmbeddable: (...args: unknown[]) => mockCreateEmbeddable(...args),
  updateEmbeddable: (...args: unknown[]) => mockUpdateEmbeddable(...args),
  listCategories: (...args: unknown[]) => mockListCategories(...args),
  createCategory: (...args: unknown[]) => mockCreateCategory(...args),
  getStaff: (...args: unknown[]) => mockGetStaff(...args),
  updateStaff: (...args: unknown[]) => mockUpdateStaff(...args),
}));

const mockAccess = vi.fn();
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockMkdir = vi.fn();
vi.mock('fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}));

const mockReadWidgetConfig = vi.fn();
const mockWriteWidgetConfig = vi.fn();
vi.mock('../widget-config.js', () => ({
  readWidgetConfig: (...args: unknown[]) => mockReadWidgetConfig(...args),
  writeWidgetConfig: (...args: unknown[]) => mockWriteWidgetConfig(...args),
}));

const mockCreateForWorkspace = vi.fn();
vi.mock('../../../../workspace/index.js', () => ({
  createForWorkspace: (...args: unknown[]) => mockCreateForWorkspace(...args),
}));

const mockRegenerateEntryApiRegistrations = vi.fn();
vi.mock('../../../../utils/entry-api-sync.js', () => ({
  regenerateEntryApiRegistrations: (...args: unknown[]) => mockRegenerateEntryApiRegistrations(...args),
}));

const { discoverAccountTool, setupWidgetTool, updateWidgetConfigTool, setupFormTool, setFormEmailTool, getStaffSettingsTool, updateStaffSettingsTool } =
  await import('../index.js');

// --- Test helpers ---

const context = { metadata: { appId: 'app-123' }, socketId: 'socket-1' };
const mockClient = {} as any;

describe('inbox skill tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActionService.mockReturnValue(mockClient);
    mockFindById.mockResolvedValue({ path: '/tmp/airo-app-builder/app-123/preview', name: 'My App' });
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('// template content');
    mockReadWidgetConfig.mockResolvedValue({
      _support: { account: '', ui: { widget: { icon: 'webChat', color: '', position: 'bottom-right' } } },
    });
    mockWriteWidgetConfig.mockResolvedValue(undefined);
    mockCreateForWorkspace.mockReturnValue(null);
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

    it('returns alreadyConfigured when both brand and account exist in memory', async () => {
      mockMemoryGet.mockImplementation(function (_appId: string, key: string) {
        if (key === 'integrations.inbox.accountId') {
          return Promise.resolve({ exists: true, value: 'https://account.conversations.godaddy.com' });
        }
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'a1b2c3d4-0000-4000-8000-000000000001' });
        }
        return Promise.resolve({ exists: false });
      });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.alreadyConfigured).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000001');
      // Should not call listAccounts when both are cached
      expect(mockListAccounts).not.toHaveBeenCalled();
    });

    it('backfills accountId from linkedToThisApp when only brand exists in memory', async () => {
      // Legacy state: brandId exists but accountId is missing
      mockMemoryGet.mockImplementation(function (_appId: string, key: string) {
        if (key === 'integrations.inbox.accountId') {
          return Promise.resolve({ exists: false });
        }
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'a1b2c3d4-0000-4000-8000-000000000001' });
        }
        return Promise.resolve({ exists: false });
      });
      mockListAccounts.mockResolvedValue({
        success: true,
        data: {
          accounts: [
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000001', accountUrl: 'https://account.conversations.godaddy.com', name: 'My Account', ventureId: 'v1', aabAppId: 'app-123' },
          ],
          unlinkedEntitlements: [],
        },
      });

      const result = await discoverAccountTool.execute({}, context);

      // Should discover via linkedToThisApp rather than auto-creating
      expect(result.alreadyConfigured).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000001');
      expect(mockActivateAccount).not.toHaveBeenCalled();
      // Should backfill accountId to memory
      expect(mockMemorySet).toHaveBeenCalledWith(
        'app-123',
        'integrations.inbox.accountId',
        'https://account.conversations.godaddy.com',
      );
      expect(mockMemorySet).toHaveBeenCalledWith(
        'app-123',
        'integrations.inbox.brandId',
        'a1b2c3d4-0000-4000-8000-000000000001',
      );
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
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000001', accountUrl: 'https://account.conversations.godaddy.com', name: 'My Account', ventureId: 'v1', aabAppId: 'app-123' },
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000002', accountUrl: 'https://account.conversations.godaddy.com', name: 'Other', ventureId: 'v2', aabAppId: 'other-app' },
          ],
          unlinkedEntitlements: [],
        },
      });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.alreadyConfigured).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000001');
      expect(mockMemorySet).toHaveBeenCalledWith(
        'app-123',
        'integrations.inbox.accountId',
        'https://account.conversations.godaddy.com',
      );
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
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000002', accountUrl: 'https://account.conversations.godaddy.com', name: 'Other', ventureId: 'v2', aabAppId: 'other-app' },
          ],
          unlinkedEntitlements: [
            { entitlementId: 'ent-1', name: 'Basic Plan', plan: 'basic', createdAt: '2025-01-01' },
          ],
        },
      });
      mockActivateAccount.mockResolvedValue({
        success: true,
        data: { name: 'New Account', brandUrl: 'a1b2c3d4-0000-4000-8000-000000000003', accountUrl: 'https://account.conversations.godaddy.com', ventureId: 'v3', aabAppId: 'app-123' },
      });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.accountCreated).toBe(true);
      expect(result.accountId).toBe('a1b2c3d4-0000-4000-8000-000000000003');
      expect(mockActivateAccount).toHaveBeenCalledWith(mockClient, 'app-123', 'ent-1', 'My App');
      expect(mockMemorySet).toHaveBeenCalledWith(
        'app-123',
        'integrations.inbox.accountId',
        'https://account.conversations.godaddy.com',
      );
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
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000004', accountUrl: 'https://account.conversations.godaddy.com', name: 'Free Account', ventureId: 'v1', aabAppId: null },
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000005', accountUrl: 'https://account.conversations.godaddy.com', name: 'Linked', ventureId: 'v2', aabAppId: 'other-app' },
          ],
          unlinkedEntitlements: [
            { entitlementId: 'ent-1', name: 'Basic Plan', plan: 'basic', createdAt: '2025-01-01' },
          ],
        },
      });
      mockActivateAccount.mockResolvedValue({
        success: true,
        data: { name: 'New Account', brandUrl: 'a1b2c3d4-0000-4000-8000-000000000003', accountUrl: 'https://account.conversations.godaddy.com', ventureId: 'v3', aabAppId: 'app-123' },
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

    it('returns error when linkedToThisApp account is missing accountUrl', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });
      mockListAccounts.mockResolvedValue({
        success: true,
        data: {
          accounts: [
            { brandUrl: 'a1b2c3d4-0000-4000-8000-000000000001', accountUrl: undefined, name: 'My Account', ventureId: 'v1', aabAppId: 'app-123' } as any,
          ],
          unlinkedEntitlements: [],
        },
      });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.error).toContain('missing required fields');
    });

    it('returns error when activateAccount response is missing accountUrl', async () => {
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
      mockActivateAccount.mockResolvedValue({
        success: true,
        data: { name: 'New Account', brandUrl: 'a1b2c3d4-0000-4000-8000-000000000003', accountUrl: undefined, ventureId: 'v3', aabAppId: 'app-123' } as any,
      });

      const result = await discoverAccountTool.execute({}, context);

      expect(result.error).toContain('missing required fields');
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

      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('chat-templates/components/InboxChatWidget.tsx'),
        'utf-8',
      );
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('chat-templates/lib/inboxChat.config.json'),
        'utf-8',
      );
    });

    it('returns error when template auto-install fails', async () => {
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockReadFile.mockRejectedValue(new Error('disk full'));

      const result = await setupWidgetTool.execute({}, context);

      expect(result.error).toContain('Failed to auto-install');
    });

    it('does not install template when widget already exists', async () => {
      mockAccess.mockResolvedValue(undefined);

      await setupWidgetTool.execute({}, context);

      expect(mockWriteFile).not.toHaveBeenCalled();
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

  // --------------------------------------------------------------------------
  // setup_form
  // --------------------------------------------------------------------------

  describe('setup_form', () => {
    const formInput = { name: 'contact-us' };

    function setupMemoryMocks(): void {
      mockMemoryGet.mockImplementation((_appId: string, key: string) => {
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'brand-123' });
        }
        if (key === 'integrations.inbox.contactFormCategoryId') {
          return Promise.resolve({ exists: true, value: 42 });
        }
        return Promise.resolve({ exists: false });
      });
    }

    it('has correct tool definition', () => {
      expect(setupFormTool.name).toBe('setup_form');
      expect(setupFormTool.execute).toBeTypeOf('function');
    });

    it('returns error when appId is missing', async () => {
      const result = await setupFormTool.execute(formInput, {});
      expect(result.error).toContain('App ID required');
    });

    it('returns error when app path cannot be resolved', async () => {
      mockFindById.mockResolvedValue(null);

      const result = await setupFormTool.execute(formInput, context);

      expect(result.error).toContain('Could not resolve app path');
    });

    it('returns error when brand is not configured', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });

      const result = await setupFormTool.execute(formInput, context);

      expect(result.error).toContain('No account configured');
    });

    it('auto-ensures email channel when categoryId is not in memory', async () => {
      mockMemoryGet.mockImplementation((_appId: string, key: string) => {
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'brand-123' });
        }
        return Promise.resolve({ exists: false });
      });
      mockFindById.mockReturnValue({ path: '/app' });
      mockListCategories.mockResolvedValue({
        success: true,
        data: [{ id: 42, name: 'Support', channel_type: 1, status: 'enabled' }],
      });
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await setupFormTool.execute(formInput, context);

      expect(result.success).toBe(true);
      expect(mockMemorySet).toHaveBeenCalledWith('app-123', 'integrations.inbox.contactFormCategoryId', 42);
    });

    it('creates email channel when none exists and categoryId not in memory', async () => {
      mockMemoryGet.mockImplementation((_appId: string, key: string) => {
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'brand-123' });
        }
        return Promise.resolve({ exists: false });
      });
      mockFindById.mockReturnValue({ path: '/app' });
      mockListCategories.mockResolvedValue({ success: true, data: [] });
      mockCreateCategory.mockResolvedValue({
        success: true,
        data: { id: 99, name: 'Contact Form', channel_type: 1 },
      });
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await setupFormTool.execute(formInput, context);

      expect(result.success).toBe(true);
      expect(mockCreateCategory).toHaveBeenCalledWith(
        mockClient, 'app-123', 'brand-123', { name: 'Contact Form', channel_type: 1 },
      );
      expect(mockMemorySet).toHaveBeenCalledWith('app-123', 'integrations.inbox.contactFormCategoryId', 99);
    });

    it('returns error when ensure email channel fails', async () => {
      mockMemoryGet.mockImplementation((_appId: string, key: string) => {
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'brand-123' });
        }
        return Promise.resolve({ exists: false });
      });
      mockFindById.mockReturnValue({ path: '/app' });
      mockListCategories.mockResolvedValue({ success: false, error: 'network error' });

      const result = await setupFormTool.execute(formInput, context);

      expect(result.error).toContain('Failed to list categories');
    });

    it('returns error when client is unavailable and categoryId not in memory', async () => {
      mockMemoryGet.mockImplementation((_appId: string, key: string) => {
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'brand-123' });
        }
        return Promise.resolve({ exists: false });
      });
      mockFindById.mockReturnValue({ path: '/app' });
      mockGetActionService.mockReturnValue(null);

      const result = await setupFormTool.execute(formInput, context);

      expect(result.error).toContain('ClientActionService not available');
    });

    it('installs route template when file is missing', async () => {
      setupMemoryMocks();
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockReadFile.mockResolvedValue('// route template content');
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const result = await setupFormTool.execute(formInput, context);

      expect(result.success).toBe(true);
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('contact-templates/server/api/contact/[formName]/POST.ts'),
        'utf-8',
      );
      expect(mockMkdir).toHaveBeenCalled();
    });

    it('skips route install when file exists', async () => {
      setupMemoryMocks();
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);

      const result = await setupFormTool.execute(formInput, context);

      expect(result.success).toBe(true);
      // readFile is called for existing config, but not for template install
      expect(mockReadFile).not.toHaveBeenCalledWith(
        expect.stringContaining('contact-templates'),
        'utf-8',
      );
    });

    it('writes config with form entry in forms map', async () => {
      setupMemoryMocks();
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      await setupFormTool.execute(formInput, context);

      const expectedConfig = { forms: { 'contact-us': { brandId: 'brand-123', categoryId: 42 } } };
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('contact-form.config.json'),
        JSON.stringify(expectedConfig, null, 2) + '\n',
      );
    });

    it('does not include overrideEmail in config (use set_form_email instead)', async () => {
      setupMemoryMocks();
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      await setupFormTool.execute({ name: 'support' }, context);

      const expectedConfig = { forms: { support: { brandId: 'brand-123', categoryId: 42 } } };
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('contact-form.config.json'),
        JSON.stringify(expectedConfig, null, 2) + '\n',
      );
    });

    it('merges new form into existing config without clobbering', async () => {
      setupMemoryMocks();
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      const existingConfig = { forms: { 'existing-form': { brandId: 'brand-123', categoryId: 10 } } };
      mockReadFile.mockResolvedValue(JSON.stringify(existingConfig));

      await setupFormTool.execute({ name: 'new-form' }, context);

      const expectedConfig = {
        forms: {
          'existing-form': { brandId: 'brand-123', categoryId: 10 },
          'new-form': { brandId: 'brand-123', categoryId: 42 },
        },
      };
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('contact-form.config.json'),
        JSON.stringify(expectedConfig, null, 2) + '\n',
      );
    });

    it('overwrites existing form entry when same name is used (idempotent)', async () => {
      setupMemoryMocks();
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      const existingConfig = { forms: { 'contact-us': { brandId: 'old-brand', categoryId: 99 } } };
      mockReadFile.mockResolvedValue(JSON.stringify(existingConfig));

      await setupFormTool.execute(formInput, context);

      const expectedConfig = { forms: { 'contact-us': { brandId: 'brand-123', categoryId: 42 } } };
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('contact-form.config.json'),
        JSON.stringify(expectedConfig, null, 2) + '\n',
      );
    });

    it('returns formName and postUrl on success', async () => {
      setupMemoryMocks();
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await setupFormTool.execute(formInput, context);

      expect(result.success).toBe(true);
      expect(result.formName).toBe('contact-us');
      expect(result.postUrl).toBe('/api/contact/contact-us');
    });

    it('returns error when route template copy fails', async () => {
      setupMemoryMocks();
      mockAccess.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockReadFile.mockRejectedValue(new Error('disk full'));

      const result = await setupFormTool.execute(formInput, context);

      expect(result.error).toContain('Failed to install contact form route');
    });

    it('reports routeRegistration.registered=true when entry.ts is rewritten', async () => {
      setupMemoryMocks();
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockCreateForWorkspace.mockReturnValue({ files: {} });
      mockRegenerateEntryApiRegistrations.mockResolvedValue({ changed: true, reason: 'rewritten', routeCount: 1 });

      const result = await setupFormTool.execute(formInput, context);

      expect(result.success).toBe(true);
      expect(result.routeRegistration).toEqual({ registered: true });
      expect(mockRegenerateEntryApiRegistrations).toHaveBeenCalledWith({});
    });

    it('reports routeRegistration.registered=false when markers are missing', async () => {
      setupMemoryMocks();
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockCreateForWorkspace.mockReturnValue({ files: {} });
      mockRegenerateEntryApiRegistrations.mockResolvedValue({ changed: false, reason: 'markers-missing', routeCount: 1 });

      const result = await setupFormTool.execute(formInput, context);

      expect(result.success).toBe(true);
      expect(result.routeRegistration).toEqual({ registered: false, reason: 'markers-missing' });
    });

    it('reports routeRegistration.registered=false when workspace is unavailable', async () => {
      setupMemoryMocks();
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockCreateForWorkspace.mockReturnValue(null);

      const result = await setupFormTool.execute(formInput, context);

      expect(result.success).toBe(true);
      expect(result.routeRegistration).toEqual({ registered: false, reason: 'no-workspace' });
      expect(mockRegenerateEntryApiRegistrations).not.toHaveBeenCalled();
    });

    it('reports routeRegistration.registered=false when regeneration throws', async () => {
      setupMemoryMocks();
      mockAccess.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
      mockCreateForWorkspace.mockReturnValue({ files: {} });
      mockRegenerateEntryApiRegistrations.mockRejectedValue(new Error('workspace connection lost'));

      const result = await setupFormTool.execute(formInput, context);

      expect(result.success).toBe(true);
      expect(result.routeRegistration).toEqual({ registered: false, reason: 'workspace connection lost' });
    });
  });

  // --------------------------------------------------------------------------
  // set_form_email
  // --------------------------------------------------------------------------

  describe('set_form_email', () => {
    it('sets overrideEmail on an existing form', async () => {
      const existingConfig = { forms: { support: { brandId: 'brand-123', categoryId: 42 } } };
      mockReadFile.mockResolvedValue(JSON.stringify(existingConfig));
      mockWriteFile.mockResolvedValue(undefined);

      const result = await setFormEmailTool.execute({ formName: 'support', email: 'support@test.com' }, context);

      expect(result.success).toBe(true);
      expect(result.email).toBe('support@test.com');
      const expectedConfig = { forms: { support: { brandId: 'brand-123', categoryId: 42, overrideEmail: 'support@test.com' } } };
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('contact-form.config.json'),
        JSON.stringify(expectedConfig, null, 2) + '\n',
      );
    });

    it('removes overrideEmail when email is omitted', async () => {
      const existingConfig = { forms: { support: { brandId: 'brand-123', categoryId: 42, overrideEmail: 'old@test.com' } } };
      mockReadFile.mockResolvedValue(JSON.stringify(existingConfig));
      mockWriteFile.mockResolvedValue(undefined);

      const result = await setFormEmailTool.execute({ formName: 'support' }, context);

      expect(result.success).toBe(true);
      expect(result.email).toBeNull();
      const expectedConfig = { forms: { support: { brandId: 'brand-123', categoryId: 42 } } };
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('contact-form.config.json'),
        JSON.stringify(expectedConfig, null, 2) + '\n',
      );
    });

    it('returns error when form does not exist', async () => {
      const existingConfig = { forms: { other: { brandId: 'brand-123', categoryId: 42 } } };
      mockReadFile.mockResolvedValue(JSON.stringify(existingConfig));

      const result = await setFormEmailTool.execute({ formName: 'support', email: 'x@test.com' }, context);

      expect(result.error).toContain('Form "support" not found');
    });

    it('returns error when config file is missing (no forms set up)', async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await setFormEmailTool.execute({ formName: 'support', email: 'x@test.com' }, context);

      expect(result.error).toContain('Form "support" not found');
    });
  });

  // --------------------------------------------------------------------------
  // get_staff_settings
  // --------------------------------------------------------------------------

  describe('get_staff_settings', () => {
    beforeEach(() => {
      mockMemoryGet.mockImplementation((_appId: string, key: string) => {
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'a1b2c3d4-0000-4000-8000-000000000001' });
        }
        return Promise.resolve({ exists: false });
      });
    });

    it('has correct tool definition', () => {
      expect(getStaffSettingsTool.name).toBe('get_staff_settings');
      expect(getStaffSettingsTool.execute).toBeTypeOf('function');
    });

    it('returns error when appId is missing', async () => {
      const result = await getStaffSettingsTool.execute({}, {});
      expect(result.error).toContain('App ID required');
    });

    it('returns error when brand is not configured', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });

      const result = await getStaffSettingsTool.execute({}, context);

      expect(result.error).toContain('No Inbox account configured');
    });

    it('returns error when client is not available', async () => {
      mockGetActionService.mockReturnValue(null);

      const result = await getStaffSettingsTool.execute({}, context);

      expect(result.error).toContain('ClientActionService not available');
    });

    it('returns error when getStaff fails', async () => {
      mockGetStaff.mockResolvedValue({ success: false, error: 'Timeout' });

      const result = await getStaffSettingsTool.execute({}, context);

      expect(result.error).toContain('Timeout');
    });

    it('returns notification email on success', async () => {
      mockGetStaff.mockResolvedValue({
        success: true,
        data: { id: 42, notification_email: 'jane@mail.com' },
      });

      const result = await getStaffSettingsTool.execute({}, context);

      expect(result.success).toBe(true);
      expect(result.notificationEmail).toBe('jane@mail.com');
    });

    it('returns null notification email when not set', async () => {
      mockGetStaff.mockResolvedValue({
        success: true,
        data: { id: 42, notification_email: null },
      });

      const result = await getStaffSettingsTool.execute({}, context);

      expect(result.success).toBe(true);
      expect(result.notificationEmail).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // update_staff_settings
  // --------------------------------------------------------------------------

  describe('update_staff_settings', () => {
    beforeEach(() => {
      mockMemoryGet.mockImplementation((_appId: string, key: string) => {
        if (key === 'integrations.inbox.brandId') {
          return Promise.resolve({ exists: true, value: 'a1b2c3d4-0000-4000-8000-000000000001' });
        }
        return Promise.resolve({ exists: false });
      });
      mockGetStaff.mockResolvedValue({
        success: true,
        data: { id: 42, notification_email: 'old@example.com' },
      });
      mockUpdateStaff.mockResolvedValue({
        success: true,
        data: { id: 42, notification_email: 'new@example.com' },
      });
    });

    it('has correct tool definition', () => {
      expect(updateStaffSettingsTool.name).toBe('update_staff_settings');
      expect(updateStaffSettingsTool.execute).toBeTypeOf('function');
    });

    it('returns error when appId is missing', async () => {
      const result = await updateStaffSettingsTool.execute({ notificationEmail: 'x@test.com' }, {});
      expect(result.error).toContain('App ID required');
    });

    it('returns error when brand is not configured', async () => {
      mockMemoryGet.mockResolvedValue({ exists: false });

      const result = await updateStaffSettingsTool.execute({ notificationEmail: 'x@test.com' }, context);

      expect(result.error).toContain('No Inbox account configured');
    });

    it('returns error when client is not available', async () => {
      mockGetActionService.mockReturnValue(null);

      const result = await updateStaffSettingsTool.execute({ notificationEmail: 'x@test.com' }, context);

      expect(result.error).toContain('ClientActionService not available');
    });

    it('returns error when getStaff fails', async () => {
      mockGetStaff.mockResolvedValue({ success: false, error: 'Network error' });

      const result = await updateStaffSettingsTool.execute({ notificationEmail: 'x@test.com' }, context);

      expect(result.error).toContain('Network error');
    });

    it('returns error when updateStaff fails', async () => {
      mockUpdateStaff.mockResolvedValue({ success: false, error: 'Forbidden' });

      const result = await updateStaffSettingsTool.execute({ notificationEmail: 'x@test.com' }, context);

      expect(result.error).toContain('Forbidden');
    });

    it('updates notification email successfully', async () => {
      const result = await updateStaffSettingsTool.execute({ notificationEmail: 'new@example.com' }, context);

      expect(result.success).toBe(true);
      expect(result.notificationEmail).toBe('new@example.com');
      expect(mockGetStaff).toHaveBeenCalledWith(mockClient, 'app-123', 'a1b2c3d4-0000-4000-8000-000000000001');
      expect(mockUpdateStaff).toHaveBeenCalledWith(
        mockClient,
        'app-123',
        'a1b2c3d4-0000-4000-8000-000000000001',
        42,
        { notification_email: 'new@example.com' },
      );
    });
  });
});
