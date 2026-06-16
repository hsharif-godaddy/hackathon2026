import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAppFetch = vi.fn();

class MockAuthDismissedError extends Error {
  constructor() {
    super('Authentication dismissed');
    this.name = 'AuthDismissedError';
  }
}

vi.mock('@/lib/gasket-config', () => ({
  appFetch: (...args: unknown[]) => mockAppFetch(...args),
  AuthDismissedError: MockAuthDismissedError,
}));

vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { inboxAction } = await import('./inboxAction');

describe('inboxAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Parameter validation
  // --------------------------------------------------------------------------

  describe('parameter validation', () => {
    it('throws when operation is missing', async () => {
      await expect(inboxAction({} as any)).rejects.toThrow(
        'operation is required and must be a string',
      );
    });

    it('throws when operation is not a string', async () => {
      await expect(inboxAction({ operation: 123 } as any)).rejects.toThrow(
        'operation is required and must be a string',
      );
    });

    it('does NOT require brandId for list_accounts', async () => {
      mockAppFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 200, data: {} }),
      });
      await expect(
        inboxAction({ operation: 'list_accounts' } as any),
      ).resolves.toBeDefined();
    });

    it('does NOT require brandId for activate_account', async () => {
      mockAppFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 200, data: {} }),
      });
      await expect(
        inboxAction({ operation: 'activate_account', body: {} } as any),
      ).resolves.toBeDefined();
    });

    it('throws when update_embeddable is missing embeddableId', async () => {
      await expect(
        inboxAction({ operation: 'update_embeddable', brandId: 'x' } as any),
      ).rejects.toThrow('embeddableId (number) is required for update_embeddable');
    });

    it('throws when update_embeddable has non-numeric embeddableId', async () => {
      await expect(
        inboxAction({ operation: 'update_embeddable', brandId: 'x', embeddableId: '42' } as any),
      ).rejects.toThrow('embeddableId (number) is required for update_embeddable');
    });

    it('throws when update_staff is missing staffId', async () => {
      await expect(
        inboxAction({ operation: 'update_staff', brandId: 'x' } as any),
      ).rejects.toThrow('staffId (number) is required for update_staff');
    });

    it('throws when update_staff has non-numeric staffId', async () => {
      await expect(
        inboxAction({ operation: 'update_staff', brandId: 'x', staffId: '7' } as any),
      ).rejects.toThrow('staffId (number) is required for update_staff');
    });
  });

  // --------------------------------------------------------------------------
  // Successful call
  // --------------------------------------------------------------------------

  describe('successful call', () => {
    it('calls appFetch with correct URL, method, and body', async () => {
      mockAppFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 200, data: { embeddables: [] } }),
      });

      await inboxAction({
        operation: 'list_embeddables',
        brandId: 'acme',
        embeddableId: 5,
        body: { foo: 'bar' },
      } as any);

      expect(mockAppFetch).toHaveBeenCalledWith(
        '/api/inbox',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'list_embeddables',
            brandId: 'acme',
            embeddableId: 5,
            body: { foo: 'bar' },
          }),
        },
      );
    });

    it('includes staffId in forwarded body for update_staff', async () => {
      mockAppFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 200, data: { staff: { id: 7 } } }),
      });

      await inboxAction({
        operation: 'update_staff',
        brandId: 'acme',
        staffId: 7,
        body: { notification_email: 'a@b.com' },
      } as any);

      expect(mockAppFetch).toHaveBeenCalledWith(
        '/api/inbox',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation: 'update_staff',
            brandId: 'acme',
            staffId: 7,
            body: { notification_email: 'a@b.com' },
          }),
        },
      );
    });

    it('returns parsed { status, data } on success', async () => {
      const payload = { status: 200, data: { embeddables: [{ id: 1 }] } };
      mockAppFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(payload),
      });

      const result = await inboxAction({
        operation: 'list_embeddables',
        brandId: 'acme',
      } as any);

      expect(result).toEqual(payload);
    });

    it('logs upstream-error when BFF returns 200 but upstream status >= 400', async () => {
      const { logger } = await import('@/lib/request-context');
      const payload = { status: 503, data: { error: 'Service Unavailable' } };
      mockAppFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(payload),
      });

      const result = await inboxAction({
        operation: 'list_embeddables',
        brandId: 'acme',
      } as any);

      expect(result).toEqual(payload);
      expect(logger.error).toHaveBeenCalledWith('inbox-action.upstream-error', expect.objectContaining({
        operation: 'list_embeddables',
        upstreamStatus: 503,
      }));
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('throws with status and truncated error text when response is not OK', async () => {
      mockAppFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden: insufficient permissions'),
      });

      await expect(
        inboxAction({ operation: 'list_embeddables', brandId: 'acme' } as any),
      ).rejects.toThrow('Inbox proxy failed: 403 Forbidden: insufficient permissions');
    });

    it('re-throws AuthDismissedError', async () => {
      mockAppFetch.mockRejectedValue(new MockAuthDismissedError());

      await expect(
        inboxAction({ operation: 'list_accounts' } as any),
      ).rejects.toThrow('Authentication dismissed');
    });

    it('re-throws unexpected errors', async () => {
      mockAppFetch.mockRejectedValue(new Error('Network failure'));

      await expect(
        inboxAction({ operation: 'list_accounts' } as any),
      ).rejects.toThrow('Network failure');
    });
  });
});
