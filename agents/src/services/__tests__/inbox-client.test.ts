import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logging/index.js', () => ({
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const mockExecuteAction = vi.fn();
const mockClient = { executeAction: mockExecuteAction } as any;

const { listEmbeddables, createEmbeddable, updateEmbeddable, listAccounts, activateAccount, listCategories, createCategory, getStaff, updateStaff } =
  await import('../inbox-client.js');

describe('inbox-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // dispatch — shared plumbing
  // --------------------------------------------------------------------------

  describe('dispatch (via listEmbeddables)', () => {
    it('returns success when client action succeeds with 2xx', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { embeddables: [{ id: 1, title: 'Widget' }] } },
      });

      const result = await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([{ id: 1, title: 'Widget' }]);
      }
    });

    it('returns error when executeAction rejects', async () => {
      mockExecuteAction.mockRejectedValue(new Error('WebSocket disconnected'));

      const result = await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('WebSocket disconnected');
      }
    });

    it('returns error when client action returns success: false', async () => {
      mockExecuteAction.mockResolvedValue({
        success: false,
        error: 'timeout exceeded',
      });

      const result = await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('timeout exceeded');
      }
    });

    it('returns error when BFF response has no status field', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { data: {} },
      });

      const result = await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('BFF returned unexpected shape');
      }
    });

    it('returns error with message field on non-2xx status', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 403, data: { message: 'Forbidden' } },
      });

      const result = await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Forbidden');
        expect(result.status).toBe(403);
      }
    });

    it('extracts error from "error" field', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 500, data: { error: 'Internal server error' } },
      });

      const result = await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('Internal server error');
      }
    });

    it('extracts error from "errors" array', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 422, data: { errors: ['title required', 'position invalid'] } },
      });

      const result = await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('title required; position invalid');
      }
    });

    it('falls back to "HTTP {status}" when no error text available', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 503, data: null },
      });

      const result = await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('HTTP 503');
      }
    });

    it('passes correct params to executeAction', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { embeddables: [] } },
      });

      await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(mockExecuteAction).toHaveBeenCalledWith({
        action: 'inboxCall',
        params: { operation: 'list_embeddables', brandId: 'a1b2c3d4-0000-4000-8000-000000000001' },
        timeoutMs: 30_000,
      });
    });

    it('returns fallback error when client action success is false with no error', async () => {
      mockExecuteAction.mockResolvedValue({
        success: false,
      });

      const result = await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe('client action failed');
      }
    });
  });

  // --------------------------------------------------------------------------
  // listEmbeddables
  // --------------------------------------------------------------------------

  describe('listEmbeddables', () => {
    it('defaults to empty array when response has no embeddables field', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: {} },
      });

      const result = await listEmbeddables(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });
  });

  // --------------------------------------------------------------------------
  // createEmbeddable
  // --------------------------------------------------------------------------

  describe('createEmbeddable', () => {
    it('handles response with nested embeddable field', async () => {
      const embeddable = { id: 42, title: 'Chat Widget' };
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 201, data: { embeddable } },
      });

      const result = await createEmbeddable(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001', {
        title: 'Chat Widget',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(embeddable);
      }
    });

    it('handles flat embeddable response (no wrapper)', async () => {
      const embeddable = { id: 42, title: 'Chat Widget' };
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 201, data: embeddable },
      });

      const result = await createEmbeddable(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001', {
        title: 'Chat Widget',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(42);
      }
    });

    it('passes input wrapped in { embeddable: input } as body', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 201, data: { embeddable: { id: 1 } } },
      });

      await createEmbeddable(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001', {
        title: 'Widget',
        shoutbox_position: 'bottom-right',
      });

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            operation: 'create_embeddable',
            brandId: 'a1b2c3d4-0000-4000-8000-000000000001',
            body: { embeddable: { title: 'Widget', shoutbox_position: 'bottom-right' } },
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // updateEmbeddable
  // --------------------------------------------------------------------------

  describe('updateEmbeddable', () => {
    it('passes embeddableId in dispatch params', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { embeddable: { id: 99 } } },
      });

      await updateEmbeddable(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001', 99, {
        shoutbox_position: 'bottom-left',
      });

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            operation: 'update_embeddable',
            brandId: 'a1b2c3d4-0000-4000-8000-000000000001',
            embeddableId: 99,
            body: { embeddable: { shoutbox_position: 'bottom-left' } },
          }),
        }),
      );
    });

    it('handles flat response (no embeddable wrapper)', async () => {
      const embeddable = { id: 99, title: 'Updated' };
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: embeddable },
      });

      const result = await updateEmbeddable(mockClient, 'app-1', 'a1b2c3d4-0000-4000-8000-000000000001', 99, {});

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(99);
      }
    });
  });

  // --------------------------------------------------------------------------
  // listAccounts
  // --------------------------------------------------------------------------

  describe('listAccounts', () => {
    it('returns accounts and unlinkedEntitlements on success', async () => {
      const accounts = [{ name: 'Acme', brandUrl: 'a1b2c3d4-0000-4000-8000-000000000006', ventureId: 'v1', aabAppId: null }];
      const unlinkedEntitlements = [{ entitlementId: 'e1', name: 'Plan', plan: 'basic', createdAt: '2025-01-01' }];
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { accounts, unlinkedEntitlements } },
      });

      const result = await listAccounts(mockClient, 'app-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.accounts).toEqual(accounts);
        expect(result.data.unlinkedEntitlements).toEqual(unlinkedEntitlements);
      }
    });

    it('defaults arrays to empty when fields missing', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: {} },
      });

      const result = await listAccounts(mockClient, 'app-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.accounts).toEqual([]);
        expect(result.data.unlinkedEntitlements).toEqual([]);
      }
    });

    it('does not pass brandId in params (account-level operation)', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { accounts: [], unlinkedEntitlements: [] } },
      });

      await listAccounts(mockClient, 'app-1');

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { operation: 'list_accounts' },
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // activateAccount
  // --------------------------------------------------------------------------

  describe('activateAccount', () => {
    it('passes appId, entitlementId, and appName in body', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { name: 'New Account', brandUrl: 'a1b2c3d4-0000-4000-8000-000000000007', ventureId: 'v1', aabAppId: 'app-1' } },
      });

      await activateAccount(mockClient, 'app-1', 'ent-123', 'My App');

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            operation: 'activate_account',
            body: { aabAppId: 'app-1', aabEntitlementId: 'ent-123', aabAppName: 'My App' },
          }),
        }),
      );
    });

    it('omits aabEntitlementId and aabAppName when not provided', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { name: 'New Account', brandUrl: 'a1b2c3d4-0000-4000-8000-000000000007', ventureId: 'v1', aabAppId: 'app-1' } },
      });

      await activateAccount(mockClient, 'app-1');

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            operation: 'activate_account',
            body: { aabAppId: 'app-1' },
          }),
        }),
      );
    });

    it('returns account data on success', async () => {
      const account = { name: 'New', brandUrl: 'new', ventureId: 'v1', aabAppId: 'app-1' };
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 201, data: account },
      });

      const result = await activateAccount(mockClient, 'app-1', 'ent-123', 'My App');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(account);
      }
    });
  });

  // --------------------------------------------------------------------------
  // listCategories
  // --------------------------------------------------------------------------

  describe('listCategories', () => {
    it('returns categories on success', async () => {
      const categories = [{ id: 1, name: 'Support', channel_type: 1, status: 'enabled' }];
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { categories } },
      });

      const result = await listCategories(mockClient, 'app-1', 'brand-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(categories);
      }
    });

    it('defaults to empty array when categories field is missing', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: {} },
      });

      const result = await listCategories(mockClient, 'app-1', 'brand-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual([]);
      }
    });

    it('passes brandId in params', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { categories: [] } },
      });

      await listCategories(mockClient, 'app-1', 'brand-1');

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            operation: 'list_categories',
            brandId: 'brand-1',
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // createCategory
  // --------------------------------------------------------------------------

  describe('createCategory', () => {
    it('handles response with nested category field', async () => {
      const category = { id: 42, name: 'Contact Form', channel_type: 1 };
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 201, data: { category } },
      });

      const result = await createCategory(mockClient, 'app-1', 'brand-1', {
        name: 'Contact Form',
        channel_type: 1,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(category);
      }
    });

    it('handles flat category response (no wrapper)', async () => {
      const category = { id: 42, name: 'Contact Form', channel_type: 1 };
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 201, data: category },
      });

      const result = await createCategory(mockClient, 'app-1', 'brand-1', {
        name: 'Contact Form',
        channel_type: 1,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(42);
      }
    });

    it('returns error when response is missing category.id', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 201, data: { name: 'No ID' } },
      });

      const result = await createCategory(mockClient, 'app-1', 'brand-1', {
        name: 'Contact Form',
        channel_type: 1,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('missing category.id');
      }
    });

    it('passes input wrapped in { category: input } as body', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 201, data: { category: { id: 1, name: 'Contact Form', channel_type: 1 } } },
      });

      await createCategory(mockClient, 'app-1', 'brand-1', {
        name: 'Contact Form',
        channel_type: 1,
      });

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            operation: 'create_category',
            brandId: 'brand-1',
            body: { category: { name: 'Contact Form', channel_type: 1 } },
          }),
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // getStaff
  // --------------------------------------------------------------------------

  describe('getStaff', () => {
    it('passes brandId in dispatch params', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { staff: { id: 7, notification_email: 'a@b.com' } } },
      });

      await getStaff(mockClient, 'app-1', 'brand-1');

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            operation: 'get_staff',
            brandId: 'brand-1',
          }),
        }),
      );
    });

    it('handles response with nested staff field', async () => {
      const staff = { id: 7, notification_email: 'a@b.com' };
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { staff } },
      });

      const result = await getStaff(mockClient, 'app-1', 'brand-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(staff);
      }
    });

    it('handles flat response (no staff wrapper)', async () => {
      const staff = { id: 7, notification_email: null };
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: staff },
      });

      const result = await getStaff(mockClient, 'app-1', 'brand-1');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(7);
      }
    });

    it('returns error when response is missing staff.id', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { notification_email: 'a@b.com' } },
      });

      const result = await getStaff(mockClient, 'app-1', 'brand-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('missing staff.id');
      }
    });
  });

  // --------------------------------------------------------------------------
  // updateStaff
  // --------------------------------------------------------------------------

  describe('updateStaff', () => {
    it('passes staffId and body in dispatch params', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { staff: { id: 7, notification_email: 'new@b.com' } } },
      });

      await updateStaff(mockClient, 'app-1', 'brand-1', 7, { notification_email: 'new@b.com' });

      expect(mockExecuteAction).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            operation: 'update_staff',
            brandId: 'brand-1',
            staffId: 7,
            body: { notification_email: 'new@b.com' },
          }),
        }),
      );
    });

    it('handles response with nested staff field', async () => {
      const staff = { id: 7, notification_email: 'new@b.com' };
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { staff } },
      });

      const result = await updateStaff(mockClient, 'app-1', 'brand-1', 7, { notification_email: 'new@b.com' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(staff);
      }
    });

    it('handles flat response (no staff wrapper)', async () => {
      const staff = { id: 7, notification_email: 'new@b.com' };
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: staff },
      });

      const result = await updateStaff(mockClient, 'app-1', 'brand-1', 7, { notification_email: 'new@b.com' });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(7);
      }
    });

    it('returns error when response is missing staff.id', async () => {
      mockExecuteAction.mockResolvedValue({
        success: true,
        result: { status: 200, data: { notification_email: 'new@b.com' } },
      });

      const result = await updateStaff(mockClient, 'app-1', 'brand-1', 7, { notification_email: 'new@b.com' });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('missing staff.id');
      }
    });
  });
});
