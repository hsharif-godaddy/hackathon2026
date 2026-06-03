import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExtract = vi.fn();
const mockGetTemplateConfig = vi.fn();
const mockSendMessage = vi.fn();
const mockGetApp = vi.fn();
const mockGetTransferMetadata = vi.fn();
const mockGetPublishedAppCount = vi.fn();
const mockGetAppCount = vi.fn();
const mockGetCustomer = vi.fn();

vi.mock('../../extractor/index.js', () => ({ extract: mockExtract }));
const mockIsServiceEnabled = vi.fn();
vi.mock('../../clients/switchboard.js', () => ({
  getTemplateConfig: mockGetTemplateConfig,
  isServiceEnabled: mockIsServiceEnabled,
}));
vi.mock('../../clients/messaging.js', () => ({ sendMessage: mockSendMessage }));
vi.mock('../../clients/mgmt.js', () => ({
  getApp: mockGetApp,
  getAppCount: mockGetAppCount,
  getPublishedAppCount: mockGetPublishedAppCount,
  getTransferMetadata: mockGetTransferMetadata,
}));
vi.mock('../../clients/pie.js', () => ({ getCustomer: mockGetCustomer }));
vi.mock('../../config.js', () => ({ config: { APP_BASE_URL: 'https://test.example.com' } }));
vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { processEvent } = await import('../event.js');

const EXTRACTED = { eid: 'app.published', customerId: 'cust-1', appId: 'app-1' };
const TEMPLATE = { templateNamespaceKey: 'airo', templateTypeKey: 'welcome' };

// Initiate transfer: event customer (cust-1) is the source
const INITIATE_TRANSFER = {
  id: 't1',
  sourceCustomerId: 'cust-1',
  targetCustomerId: 'target-cust',
  targetCandidateShoppers: [],
  transferToken: 'tok-xyz',
};

// Accept transfer: event customer (cust-1) is the target
const ACCEPT_TRANSFER = {
  id: 't2',
  sourceCustomerId: 'source-cust',
  targetCustomerId: 'cust-1',
  targetCandidateShoppers: [],
  transferToken: 'tok-abc',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockExtract.mockReturnValue(EXTRACTED);
  mockGetTemplateConfig.mockReturnValue([TEMPLATE]);
  mockIsServiceEnabled.mockReturnValue(true);
  mockSendMessage.mockResolvedValue(undefined);
});

describe('notification-service', () => {
  describe('#processEvent', () => {
    it('returns skipped when extract returns null', async () => {
      mockExtract.mockReturnValue(null);
      expect(await processEvent({})).toBe('skipped');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('returns skipped when no template config for eid', async () => {
      mockGetTemplateConfig.mockReturnValue(null);
      expect(await processEvent({})).toBe('skipped');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('returns sent when template has no substitutions or guard', async () => {
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    it('processes all events when service is enabled', async () => {
      mockIsServiceEnabled.mockReturnValue(true);
      expect(await processEvent({})).toBe('sent');
      expect(mockGetCustomer).not.toHaveBeenCalled();
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    it('skips non-TLA event when service is disabled', async () => {
      mockIsServiceEnabled.mockReturnValue(false);
      mockGetCustomer.mockResolvedValue({ shopperId: '123456', email: 'user@example.com' });
      expect(await processEvent({})).toBe('skipped');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('allows TLA event when service is disabled (shopperId length 3)', async () => {
      mockIsServiceEnabled.mockReturnValue(false);
      mockGetCustomer.mockResolvedValue({ shopperId: 'abc', email: 'tla@example.com' });
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    it('skips template when guard fails', async () => {
      mockGetPublishedAppCount.mockResolvedValue(3);
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, guard: 'first_published_app' }]);
      expect(await processEvent({})).toBe('skipped');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sends when no_published_app guard passes (count is 0)', async () => {
      mockGetPublishedAppCount.mockResolvedValue(0);
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, guard: 'no_published_app' }]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    it('skips when no_published_app guard fails (customer has published app)', async () => {
      mockGetPublishedAppCount.mockResolvedValue(1);
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, guard: 'no_published_app' }]);
      expect(await processEvent({})).toBe('skipped');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sends when first_app guard passes (count is 1)', async () => {
      mockGetAppCount.mockResolvedValue(1);
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, guard: 'first_app' }]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    it('sends when first_app guard passes (count is 0)', async () => {
      mockGetAppCount.mockResolvedValue(0);
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, guard: 'first_app' }]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledOnce();
    });

    it('skips when first_app guard fails (customer has more than one app)', async () => {
      mockGetAppCount.mockResolvedValue(2);
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, guard: 'first_app' }]);
      expect(await processEvent({})).toBe('skipped');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('sends when first_app guard passes and appId is absent (homepage event)', async () => {
      mockExtract.mockReturnValue({ eid: 'appbuilder.homepage.prompt.submit.click', customerId: 'cust-1' });
      mockGetAppCount.mockResolvedValue(1);
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, guard: 'first_app' }]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledWith('cust-1', expect.objectContaining({ templateTypeKey: 'welcome' }));
    });

    it('skips template when substitution cannot be resolved', async () => {
      mockGetApp.mockResolvedValue({ id: 'app-1', name: '' });
      mockGetTemplateConfig.mockReturnValue([
        { ...TEMPLATE, substitutionValues: { title: '##app_name##' } },
      ]);
      expect(await processEvent({})).toBe('skipped');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('skips template when transfer_target cannot be resolved (no target on initiate)', async () => {
      mockGetTransferMetadata.mockResolvedValue({
        ...INITIATE_TRANSFER,
        targetCustomerId: null,
        targetCandidateShoppers: [],
      });
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, target: 'transfer_target' }]);
      expect(await processEvent({})).toBe('skipped');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('resolves transfer_target to targetCustomerId for initiate events', async () => {
      mockGetTransferMetadata.mockResolvedValue(INITIATE_TRANSFER);
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, target: 'transfer_target' }]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledWith('target-cust', expect.objectContaining({ templateTypeKey: 'welcome' }));
    });

    it('resolves transfer_target to event customer for accept events', async () => {
      mockGetTransferMetadata.mockResolvedValue(ACCEPT_TRANSFER);
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, target: 'transfer_target' }]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledWith('cust-1', expect.objectContaining({ templateTypeKey: 'welcome' }));
    });

    it('resolves transfer_source to sourceCustomerId for accept events', async () => {
      mockGetTransferMetadata.mockResolvedValue(ACCEPT_TRANSFER);
      mockGetTemplateConfig.mockReturnValue([{ ...TEMPLATE, target: 'transfer_source' }]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledWith('source-cust', expect.objectContaining({ templateTypeKey: 'welcome' }));
    });

    it('resolves recipient_email to target customer email for initiate events', async () => {
      mockGetTransferMetadata.mockResolvedValue(INITIATE_TRANSFER);
      mockGetCustomer.mockResolvedValue({ email: 'target@example.com' });
      mockGetTemplateConfig.mockReturnValue([
        { ...TEMPLATE, substitutionValues: { email: '##recipient_email##' } },
      ]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledWith('cust-1', expect.objectContaining({
        substitutionValues: { email: 'target@example.com' },
      }));
    });

    it('resolves recipient_email to event customer email for accept events', async () => {
      mockGetTransferMetadata.mockResolvedValue(ACCEPT_TRANSFER);
      mockGetCustomer.mockResolvedValue({ email: 'accepter@example.com' });
      mockGetTemplateConfig.mockReturnValue([
        { ...TEMPLATE, substitutionValues: { email: '##recipient_email##' } },
      ]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledWith('cust-1', expect.objectContaining({
        substitutionValues: { email: 'accepter@example.com' },
      }));
    });

    it('skips template when recipient_email transfer lookup fails', async () => {
      mockGetTransferMetadata.mockRejectedValue(new Error('transfer not found'));
      mockGetTemplateConfig.mockReturnValue([
        { ...TEMPLATE, substitutionValues: { email: '##recipient_email##' } },
      ]);
      expect(await processEvent({})).toBe('skipped');
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('resolves transfer_code from transfer metadata', async () => {
      mockGetTransferMetadata.mockResolvedValue(INITIATE_TRANSFER);
      mockGetTemplateConfig.mockReturnValue([
        { ...TEMPLATE, substitutionValues: { code: '##transfer_code##' } },
      ]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledWith('cust-1', expect.objectContaining({
        substitutionValues: { code: 'tok-xyz' },
      }));
    });

    it('processes remaining templates when one throws', async () => {
      const failingTemplate = { templateNamespaceKey: 'airo', templateTypeKey: 'fail' };
      const goodTemplate = { templateNamespaceKey: 'airo', templateTypeKey: 'good' };
      mockGetTemplateConfig.mockReturnValue([failingTemplate, goodTemplate]);
      mockSendMessage
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce(undefined);

      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenLastCalledWith('cust-1', expect.objectContaining({
        templateTypeKey: 'good',
      }));
    });

    it('returns skipped when all templates throw', async () => {
      mockSendMessage.mockRejectedValue(new Error('network error'));
      expect(await processEvent({})).toBe('skipped');
    });

    it('warns on unknown placeholder key and sends literal value', async () => {
      mockGetTemplateConfig.mockReturnValue([
        { ...TEMPLATE, substitutionValues: { foo: '##nonexistent_key##' } },
      ]);
      expect(await processEvent({})).toBe('sent');
      expect(mockSendMessage).toHaveBeenCalledWith('cust-1', expect.objectContaining({
        substitutionValues: { foo: '##nonexistent_key##' },
      }));
    });
  });
});
