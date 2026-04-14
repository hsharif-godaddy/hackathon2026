/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { useSitesStore } from '@/stores/useSitesStore';
import { mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import * as instrumentation from '@/utils/instrumentation';
import AcceptTransferDialog from '../AcceptTransferDialog';

vi.mock('@/lib/gasket-config');
vi.mock('@/utils/instrumentation', () => mockInstrumentation());
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@ux/modal', () => ({
  default: ({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) => (
    <div role="dialog" aria-label={title}>
      <h2>{title}</h2>
      <button data-testid="modal-close" onClick={onClose}>Close</button>
      {children}
    </div>
  ),
}));

describe('AcceptTransferDialog', function dialogTests() {
  const defaultProps = {
    onClose: vi.fn(),
    onAccepted: vi.fn(),
  };

  beforeEach(function setup() {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useSitesStore.setState({ refreshSites: vi.fn() });
  });

  afterEach(function teardown() {
    vi.useRealTimers();
  });

  it('should render the token input form', function renderForm() {
    renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    expect(screen.getByRole('heading', { name: 'Accept Transfer' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept Transfer' })).toBeInTheDocument();
  });

  it('should disable submit when token is too short', function disableSubmit() {
    renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'Accept Transfer' })).toBeDisabled();
  });

  it('should enable submit when token is 6 characters', async function enableSubmit() {
    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');

    expect(screen.getByRole('button', { name: 'Accept Transfer' })).not.toBeDisabled();
  });

  it('should filter non-alphanumeric characters from input', async function filterInput() {
    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'AB-C!1@2#3');

    expect(screen.getByRole('textbox')).toHaveValue('ABC123');
  });

  it('should show processing step when status is processing', async function showProcessing() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        requestId: 'req-1',
        status: 'processing',
        message: 'Transfer accepted',
        appId: 'app-1',
      }),
    } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('Transfer in progress. This may take a moment...')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('should auto-close when accept returns completed', async function immediateClose() {
    const mockRefreshSites = vi.fn();
    useSitesStore.setState({ refreshSites: mockRefreshSites });

    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        requestId: 'req-1',
        status: 'completed',
        message: 'Transfer already completed',
        appId: 'app-1',
      }),
    } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(defaultProps.onAccepted).toHaveBeenCalled();
      expect(mockRefreshSites).toHaveBeenCalled();
    });
  });

  it('should auto-close when poll detects completed', async function pollAutoClose() {
    const mockRefreshSites = vi.fn();
    useSitesStore.setState({ refreshSites: mockRefreshSites });

    vi.mocked(appFetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'processing', message: 'Accepted', appId: 'app-1' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'processing', appId: 'app-1' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'completed', appId: 'app-1' }),
      } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('Transfer in progress. This may take a moment...')).toBeInTheDocument();
    });

    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(3000);

    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
      expect(defaultProps.onAccepted).toHaveBeenCalled();
      expect(mockRefreshSites).toHaveBeenCalled();
    });
  });

  it('should show error and fire error EID when poll returns failed status', async function pollToError() {
    vi.mocked(appFetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'processing', message: 'Accepted', appId: 'app-1' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'failed', appId: 'app-1' }),
      } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('Transfer in progress. This may take a moment...')).toBeInTheDocument();
    });

    await vi.advanceTimersByTimeAsync(3000);

    await waitFor(() => {
      expect(screen.getByText('The transfer failed. Please try again or contact support.')).toBeInTheDocument();
    });

    expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.accept_error');
  });

  it('should show error and fire error EID after consecutive poll failures', async function pollConsecutiveErrors() {
    vi.mocked(appFetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'processing', message: 'Accepted', appId: 'app-1' }),
      } as Response)
      .mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal Server Error' }),
      } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('Transfer in progress. This may take a moment...')).toBeInTheDocument();
    });

    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(3000);
    }

    await waitFor(() => {
      expect(screen.getByText('Unable to check transfer status. Please close and try again.')).toBeInTheDocument();
    });

    expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.accept_error');
  });

  it('should show timeout message and fire error EID when poll exceeds max attempts', async function pollTimeout() {
    vi.mocked(appFetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'processing', message: 'Accepted', appId: 'app-1' }),
      } as Response)
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'processing', appId: 'app-1' }),
      } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('Transfer in progress. This may take a moment...')).toBeInTheDocument();
    });

    for (let i = 0; i < 41; i++) {
      await vi.advanceTimersByTimeAsync(3000);
    }

    await waitFor(() => {
      expect(screen.getByText('The transfer is taking longer than expected. Please check your apps list later.')).toBeInTheDocument();
    });

    expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.accept_error');
  });

  it('should show error step on API failure', async function acceptError() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'CUSTOMER_MISMATCH' }),
    } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('CUSTOMER_MISMATCH')).toBeInTheDocument();
    });
  });

  

  it('should stop polling when dismiss is clicked during processing', async function dismissProcessing() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'processing', message: 'Accepted', appId: 'app-1' }),
    } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(defaultProps.onAccepted).not.toHaveBeenCalled();
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should allow retry after error', async function retryAfterError() {
    vi.mocked(appFetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'TRANSFER_EXPIRED' }),
    } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('TRANSFER_EXPIRED')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Try Again' }));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('should fire impression event on mount', function firesImpression() {
    renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    expect(instrumentation.logImpressionEvent).toHaveBeenCalledWith('apps.transfer.accept_dialog');
  });

  it('should fire success click event when accept completes immediately', async function firesSuccessEid() {
    const mockRefreshSites = vi.fn();
    useSitesStore.setState({ refreshSites: mockRefreshSites });

    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ requestId: 'req-1', status: 'completed', message: 'Done', appId: 'app-1' }),
    } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.accept_success');
  });

  it('should fire error click event on API failure', async function firesErrorEid() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'INVALID_TOKEN' }),
    } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('INVALID_TOKEN')).toBeInTheDocument();
    });

    expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.accept_error');
  });

  it('should fire success click event when poll detects completed', async function pollSuccessEid() {
    const mockRefreshSites = vi.fn();
    useSitesStore.setState({ refreshSites: mockRefreshSites });

    vi.mocked(appFetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'processing', message: 'Accepted', appId: 'app-1' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'completed', appId: 'app-1' }),
      } as Response);

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('Transfer in progress. This may take a moment...')).toBeInTheDocument();
    });

    await vi.advanceTimersByTimeAsync(3000);

    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.accept_success');
  });

  it('should fire error click event when submit throws', async function submitThrows() {
    vi.mocked(appFetch).mockRejectedValue(new Error('Network error'));

    const { user } = renderWithProviders(<AcceptTransferDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to accept transfer')).toBeInTheDocument();
    });

    expect(instrumentation.logClickEvent).toHaveBeenCalledWith('apps.transfer.accept_error');
  });
});
