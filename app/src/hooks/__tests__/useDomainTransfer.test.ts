/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useDomainTransfer } from '@/hooks/useDomainTransfer';
import { AIRO_SUBSCRIPTION_OWNER_TYPE, MWP_V2_APP_OWNER_TYPE } from '@/lib/mgmt-airo/types';

function createConflictData(overrides?: Partial<{
  existingAppId: string;
  existingSystemId: string;
  existingOwnerType: string;
  existingOwnerId: string;
  existingAppName: string;
  domain: string;
}>) {
  return {
    existingAppId: 'existing-app-id',
    existingSystemId: 'existing-system-id',
    existingOwnerType: AIRO_SUBSCRIPTION_OWNER_TYPE,
    existingOwnerId: 'existing-owner-id',
    existingAppName: 'Existing App',
    domain: 'taken.example.com',
    ...overrides,
  };
}

function createHookParams(overrides?: Partial<Parameters<typeof useDomainTransfer>[0]>) {
  return {
    modifyDomainsMutation: {
      mutateAsync: vi.fn(),
      reset: vi.fn(),
    } as any,
    conflictData: createConflictData(),
    setConflictData: vi.fn(),
    logger: {
      warn: vi.fn(),
      error: vi.fn(),
    },
    shipAnalyticsLog: vi.fn(),
    appId: 'app-123',
    sendUserMessage: vi.fn(),
    analyticsPrefix: 'domain.attach.widget' as const,
    unsupportedOwnerTypeErrorMessage: 'Failed to add domain',
    ...overrides,
  };
}

describe('useDomainTransfer', () => {
  it('should return early when appId is missing', async function missingAppId() {
    const params = createHookParams({ appId: undefined });
    const { result } = renderHook(() => useDomainTransfer(params));

    await act(async () => {
      await result.current.handleTransferDomain();
    });

    expect(params.modifyDomainsMutation.mutateAsync).not.toHaveBeenCalled();
    expect(params.setConflictData).not.toHaveBeenCalled();
  });

  it('should return early when conflictData is missing', async function missingConflictData() {
    const params = createHookParams({ conflictData: null });
    const { result } = renderHook(() => useDomainTransfer(params));

    await act(async () => {
      await result.current.handleTransferDomain();
    });

    expect(params.modifyDomainsMutation.mutateAsync).not.toHaveBeenCalled();
    expect(params.setConflictData).not.toHaveBeenCalled();
  });

  it('should guard unsupported owner type and set error', async function unsupportedOwnerType() {
    const params = createHookParams({
      conflictData: createConflictData({ existingOwnerType: 'unknownType' }),
    });
    const { result } = renderHook(() => useDomainTransfer(params));

    await act(async () => {
      await result.current.handleTransferDomain();
    });

    expect(params.modifyDomainsMutation.mutateAsync).not.toHaveBeenCalled();
    expect(params.logger.warn).toHaveBeenCalledWith('domain-conflict.unsupported-owner-type', {
      ownerType: 'unknownType',
    });
    expect(result.current.transferError).toBeInstanceOf(Error);
    expect(result.current.transferError?.message).toBe('Failed to add domain');
  });

  it('should guard missing systemId for Airo transfer and set error', async function missingSystemId() {
    const params = createHookParams({
      conflictData: {
        ...createConflictData(),
        existingSystemId: undefined,
      },
    });
    const { result } = renderHook(() => useDomainTransfer(params));

    await act(async () => {
      await result.current.handleTransferDomain();
    });

    expect(params.modifyDomainsMutation.mutateAsync).not.toHaveBeenCalled();
    expect(params.logger.warn).toHaveBeenCalledWith('domain-conflict.transfer.missing-system-id', {
      appId: 'app-123',
      ownerType: 'airoSubscriptionId',
    });
    expect(result.current.transferError).toBeInstanceOf(Error);
    expect(result.current.isTransferring).toBe(false);
  });

  it('should transfer domain successfully', async function transferSuccess() {
    const params = createHookParams();
    vi.mocked(params.modifyDomainsMutation.mutateAsync).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDomainTransfer(params));

    await act(async () => {
      await result.current.handleTransferDomain();
    });

    expect(params.modifyDomainsMutation.mutateAsync).toHaveBeenCalledWith({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [{ fqdn: 'taken.example.com', primary: false }],
        createCdn: true,
        isWildcardDomain: true,
        transferFrom: {
          appId: 'existing-app-id',
          systemId: 'existing-system-id',
          subscriptionId: 'existing-owner-id',
        },
      },
    });
    expect(params.setConflictData).toHaveBeenCalledWith(null);
    expect(params.modifyDomainsMutation.reset).toHaveBeenCalled();
    expect(params.shipAnalyticsLog).toHaveBeenCalledWith('domain.attach.widget.transfer.success', {
      appId: 'app-123',
      domainName: 'taken.example.com',
    });
    expect(params.sendUserMessage).toHaveBeenCalledWith('Transferred taken.example.com to this app.', {
      isActionRequest: true,
    });
    expect(result.current.isTransferring).toBe(false);
  });

  it('should transfer MWP domain successfully with transferFromMWP payload', async function transferMwpSuccess() {
    const params = createHookParams({
      conflictData: createConflictData({
        existingOwnerType: MWP_V2_APP_OWNER_TYPE,
        existingAppId: '1129971',
        existingOwnerId: '1129971',
        existingSystemId: '',
        existingAppName: 'A WordPress Site',
      }),
    });
    vi.mocked(params.modifyDomainsMutation.mutateAsync).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDomainTransfer(params));

    await act(async () => {
      await result.current.handleTransferDomain();
    });

    expect(params.modifyDomainsMutation.mutateAsync).toHaveBeenCalledWith({
      siteId: 'app-123',
      payload: {
        domainsToCreate: [{ fqdn: 'taken.example.com', primary: false }],
        createCdn: true,
        isWildcardDomain: true,
        transferFromMWP: {
          v2AppId: '1129971',
        },
      },
    });
    expect(params.modifyDomainsMutation.mutateAsync).not.toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        transferFrom: expect.any(Object),
      }),
    }));
    expect(params.setConflictData).toHaveBeenCalledWith(null);
    expect(params.modifyDomainsMutation.reset).toHaveBeenCalled();
  });

  it('should handle transfer failure and keep conflict modal open', async function transferFailure() {
    const params = createHookParams({
      analyticsPrefix: 'domain.custom',
      sendUserMessage: undefined,
    });
    const failure = new Error('Transfer failed');
    vi.mocked(params.modifyDomainsMutation.mutateAsync).mockRejectedValue(failure);
    const { result } = renderHook(() => useDomainTransfer(params));

    await act(async () => {
      await result.current.handleTransferDomain();
    });

    await waitFor(() => {
      expect(result.current.transferError?.message).toBe('Transfer failed');
    });

    expect(params.shipAnalyticsLog).toHaveBeenCalledWith('domain.custom.transfer.failed', {
      appId: 'app-123',
      domainName: 'taken.example.com',
      error: 'Transfer failed',
    });
    expect(params.logger.error).toHaveBeenCalledWith('domain-attach.transfer.failure', {
      message: 'Failed to transfer domain',
      appId: 'app-123',
      domainName: 'taken.example.com',
      error: 'Transfer failed',
    });
    expect(result.current.isTransferring).toBe(false);
    expect(params.setConflictData).not.toHaveBeenCalled();
  });

  it('should handle widget transfer failure with widget logger event', async function widgetTransferFailure() {
    const params = createHookParams({
      analyticsPrefix: 'domain.attach.widget',
      sendUserMessage: undefined,
    });
    const failure = new Error('Widget transfer failed');
    vi.mocked(params.modifyDomainsMutation.mutateAsync).mockRejectedValue(failure);
    const { result } = renderHook(() => useDomainTransfer(params));

    await act(async () => {
      await result.current.handleTransferDomain();
    });

    await waitFor(() => {
      expect(result.current.transferError?.message).toBe('Widget transfer failed');
    });

    expect(params.logger.error).toHaveBeenCalledWith('domain-attach-widget.transfer.failure', {
      message: 'Failed to transfer domain',
      appId: 'app-123',
      domainName: 'taken.example.com',
      error: 'Widget transfer failed',
    });
    expect(params.shipAnalyticsLog).toHaveBeenCalledWith('domain.attach.widget.transfer.failed', {
      appId: 'app-123',
      domainName: 'taken.example.com',
      error: 'Widget transfer failed',
    });
    expect(result.current.transferError).toBe(failure);
    expect(result.current.isTransferring).toBe(false);
  });

  it('should handle MWP transfer failure and keep conflict modal open', async function mwpTransferFailure() {
    const params = createHookParams({
      conflictData: createConflictData({
        existingOwnerType: MWP_V2_APP_OWNER_TYPE,
        existingAppId: '1129971',
        existingOwnerId: '1129971',
        existingSystemId: '',
        existingAppName: 'A WordPress Site',
      }),
      sendUserMessage: undefined,
    });
    const failure = new Error('MWP transfer failed');
    vi.mocked(params.modifyDomainsMutation.mutateAsync).mockRejectedValue(failure);
    const { result } = renderHook(() => useDomainTransfer(params));

    await act(async () => {
      await result.current.handleTransferDomain();
    });

    await waitFor(function waitForError() {
      expect(result.current.transferError?.message).toBe('MWP transfer failed');
    });

    expect(params.shipAnalyticsLog).toHaveBeenCalledWith('domain.attach.widget.transfer.failed', {
      appId: 'app-123',
      domainName: 'taken.example.com',
      error: 'MWP transfer failed',
    });
    expect(result.current.isTransferring).toBe(false);
    expect(params.setConflictData).not.toHaveBeenCalledWith(null);
  });
});
