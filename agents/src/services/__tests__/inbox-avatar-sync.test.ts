import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../logging/index.js', () => ({
  Logger: { create: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const mockGetSlot = vi.fn();
vi.mock('../MediaManifestService.js', () => ({
  mediaManifestService: {
    getSlot: (...args: unknown[]) => mockGetSlot(...args),
  },
}));

const mockGetStaff = vi.fn();
const mockUpdateStaff = vi.fn();
const mockUpdateBrand = vi.fn();
vi.mock('../inbox-client.js', () => ({
  getStaff: (...args: unknown[]) => mockGetStaff(...args),
  updateStaff: (...args: unknown[]) => mockUpdateStaff(...args),
  updateBrand: (...args: unknown[]) => mockUpdateBrand(...args),
}));

const { syncAppLogoToInboxAvatar, updateInboxAvatar } = await import('../inbox-avatar-sync.js');

describe('inbox-avatar-sync', () => {
  const mockClient = { executeAction: vi.fn() } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateInboxAvatar', () => {
    it('fetches staff and updates both staff and brand avatar', async () => {
      mockGetStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null } });
      mockUpdateStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null, avatar_url: 'https://cdn.example.com/logo.png' } });
      mockUpdateBrand.mockResolvedValue({ success: true, data: {} });

      const result = await updateInboxAvatar(mockClient, 'app-1', 'brand-123', 'https://cdn.example.com/logo.png');

      expect(mockGetStaff).toHaveBeenCalledWith(mockClient, 'app-1', 'brand-123');
      expect(mockUpdateStaff).toHaveBeenCalledWith(mockClient, 'app-1', 'brand-123', 3, { avatar_url: 'https://cdn.example.com/logo.png' });
      expect(mockUpdateBrand).toHaveBeenCalledWith(mockClient, 'app-1', 'brand-123', { avatar_url: 'https://cdn.example.com/logo.png' });
      expect(result).toEqual({ success: true, data: undefined });
    });

    it('returns failure when getStaff fails', async () => {
      mockGetStaff.mockResolvedValue({ success: false, error: 'unauthorized' });

      const result = await updateInboxAvatar(mockClient, 'app-1', 'brand-123', 'https://cdn.example.com/logo.png');

      expect(result.success).toBe(false);
      expect(mockUpdateStaff).not.toHaveBeenCalled();
    });

    it('returns failure when staff update fails', async () => {
      mockGetStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null } });
      mockUpdateStaff.mockResolvedValue({ success: false, error: 'server error' });
      mockUpdateBrand.mockResolvedValue({ success: true, data: {} });

      const result = await updateInboxAvatar(mockClient, 'app-1', 'brand-123', 'https://cdn.example.com/logo.png');

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('staff: server error');
    });

    it('returns failure when brand update fails', async () => {
      mockGetStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null } });
      mockUpdateStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null } });
      mockUpdateBrand.mockResolvedValue({ success: false, error: 'brand error' });

      const result = await updateInboxAvatar(mockClient, 'app-1', 'brand-123', 'https://cdn.example.com/logo.png');

      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('brand: brand error');
    });
  });

  describe('syncAppLogoToInboxAvatar', () => {
    it('fetches logo and updates staff and brand avatar', async () => {
      mockGetSlot.mockResolvedValue({ success: true, slot: { currentUrl: 'https://cdn.example.com/logo.png' } });
      mockGetStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null } });
      mockUpdateStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null, avatar_url: 'https://cdn.example.com/logo.png' } });
      mockUpdateBrand.mockResolvedValue({ success: true, data: {} });

      await syncAppLogoToInboxAvatar(mockClient, 'app-1', 'brand-123');

      expect(mockGetSlot).toHaveBeenCalledWith('app-1', 'logo/primary');
      expect(mockGetStaff).toHaveBeenCalledWith(mockClient, 'app-1', 'brand-123');
      expect(mockUpdateStaff).toHaveBeenCalledWith(mockClient, 'app-1', 'brand-123', 3, { avatar_url: 'https://cdn.example.com/logo.png' });
      expect(mockUpdateBrand).toHaveBeenCalledWith(mockClient, 'app-1', 'brand-123', { avatar_url: 'https://cdn.example.com/logo.png' });
    });

    it('falls back to logo/horizontal when logo/primary is missing', async () => {
      mockGetSlot
        .mockResolvedValueOnce({ success: true, slot: null })
        .mockResolvedValueOnce({ success: true, slot: { currentUrl: 'https://cdn.example.com/horizontal.png' } });
      mockGetStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null } });
      mockUpdateStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null, avatar_url: 'https://cdn.example.com/horizontal.png' } });
      mockUpdateBrand.mockResolvedValue({ success: true, data: {} });

      await syncAppLogoToInboxAvatar(mockClient, 'app-1', 'brand-123');

      expect(mockGetSlot).toHaveBeenCalledWith('app-1', 'logo/primary');
      expect(mockGetSlot).toHaveBeenCalledWith('app-1', 'logo/horizontal');
      expect(mockUpdateStaff).toHaveBeenCalledWith(mockClient, 'app-1', 'brand-123', 3, { avatar_url: 'https://cdn.example.com/horizontal.png' });
    });

    it('falls back to logo/vertical when primary and horizontal are missing', async () => {
      mockGetSlot
        .mockResolvedValueOnce({ success: true, slot: null })
        .mockResolvedValueOnce({ success: true, slot: null })
        .mockResolvedValueOnce({ success: true, slot: { currentUrl: 'https://cdn.example.com/vertical.png' } });
      mockGetStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null } });
      mockUpdateStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null, avatar_url: 'https://cdn.example.com/vertical.png' } });
      mockUpdateBrand.mockResolvedValue({ success: true, data: {} });

      await syncAppLogoToInboxAvatar(mockClient, 'app-1', 'brand-123');

      expect(mockGetSlot).toHaveBeenCalledWith('app-1', 'logo/vertical');
      expect(mockUpdateStaff).toHaveBeenCalledWith(mockClient, 'app-1', 'brand-123', 3, { avatar_url: 'https://cdn.example.com/vertical.png' });
    });

    it('returns silently when no logo slots have a URL', async () => {
      mockGetSlot.mockResolvedValue({ success: true, slot: null });

      await syncAppLogoToInboxAvatar(mockClient, 'app-1', 'brand-123');

      expect(mockGetSlot).toHaveBeenCalledTimes(3);
      expect(mockGetStaff).not.toHaveBeenCalled();
    });

    it('handles getStaff failure gracefully', async () => {
      mockGetSlot.mockResolvedValue({ success: true, slot: { currentUrl: 'https://cdn.example.com/logo.png' } });
      mockGetStaff.mockResolvedValue({ success: false, error: 'unauthorized' });

      await syncAppLogoToInboxAvatar(mockClient, 'app-1', 'brand-123');

      expect(mockUpdateStaff).not.toHaveBeenCalled();
    });

    it('handles updateStaff failure gracefully', async () => {
      mockGetSlot.mockResolvedValue({ success: true, slot: { currentUrl: 'https://cdn.example.com/logo.png' } });
      mockGetStaff.mockResolvedValue({ success: true, data: { id: 3, notification_email: null } });
      mockUpdateStaff.mockResolvedValue({ success: false, error: 'server error' });

      await expect(syncAppLogoToInboxAvatar(mockClient, 'app-1', 'brand-123')).resolves.not.toThrow();
    });
  });
});
