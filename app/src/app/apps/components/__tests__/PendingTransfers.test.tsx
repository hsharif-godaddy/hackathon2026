import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { useSitesStore } from '@/stores/useSitesStore';
import { mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import PendingTransfers from '../PendingTransfers';

vi.mock('@/lib/gasket-config');
vi.mock('@/utils/instrumentation', () => mockInstrumentation());
vi.mock('@/lib/request-context', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const emptyList = { transfers: [], total: 0, limit: 10, offset: 0 };

const mockOutgoingTransfer = {
  id: 'tr-1',
  appId: 'app-123',
  transferToken: 'abc123',
  status: 'initiated',
  sourceCustomerId: 'cust-1',
  targetCustomerId: 'cust-2',
  createdAt: '2026-03-04T12:00:00.000Z',
  expiresAt: '2026-03-07T12:00:00.000Z',
  updatedAt: '2026-03-04T12:00:00.000Z',
};

const mockIncomingTransfer = {
  id: 'tr-2',
  appId: 'app-456',
  transferToken: 'xyz789',
  status: 'initiated',
  sourceCustomerId: 'cust-3',
  targetCustomerId: 'cust-1',
  createdAt: '2026-03-04T12:00:00.000Z',
  expiresAt: '2026-03-07T12:00:00.000Z',
  updatedAt: '2026-03-04T12:00:00.000Z',
};

function mockFetchResponses(outgoing: any[] = [], incoming: any[] = []) {
  vi.mocked(appFetch).mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('direction=incoming')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ transfers: incoming, total: incoming.length, limit: 10, offset: 0 }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ transfers: outgoing, total: outgoing.length, limit: 10, offset: 0 }),
    } as Response;
  });
}

describe('PendingTransfers', function pendingTests() {
  const defaultProps = {
    onAcceptTransfer: vi.fn(),
  };

  beforeEach(function setup() {
    vi.clearAllMocks();
    useSitesStore.setState({
      allSites: [
        { id: 'app-123', name: 'Test App', status: 'running' } as any,
      ],
    });
  });

  it('should render nothing when no transfers exist', async function emptyState() {
    mockFetchResponses();

    const { container } = renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(container.querySelector('[class*="spinner"]')).not.toBeInTheDocument();
    });

    expect(screen.queryByText('Outgoing Transfers')).not.toBeInTheDocument();
    expect(screen.queryByText('Incoming Transfers')).not.toBeInTheDocument();
  });

  it('should display outgoing transfers with app name', async function showOutgoing() {
    mockFetchResponses([mockOutgoingTransfer]);

    renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Outgoing Transfers')).toBeInTheDocument();
    });

    expect(screen.getByText('Test App')).toBeInTheDocument();
    expect(screen.getByText('Initiated')).toBeInTheDocument();
    expect(screen.getByTestId('outgoing-transfers')).toBeInTheDocument();
  });

  it('should display incoming transfers with accept button', async function showIncoming() {
    mockFetchResponses([], [mockIncomingTransfer]);

    renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Incoming Transfers')).toBeInTheDocument();
    });

    expect(screen.getByText('app-456')).toBeInTheDocument();
    expect(screen.getByText('Pending Acceptance')).toBeInTheDocument();
    expect(screen.getByTestId('incoming-transfers')).toBeInTheDocument();

    const acceptButton = screen.getByRole('button', { name: 'Accept Transfer' });
    expect(acceptButton).toBeInTheDocument();
  });

  it('should call onAcceptTransfer when accept button is clicked', async function clickAccept() {
    mockFetchResponses([], [mockIncomingTransfer]);

    const { user } = renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByTestId('incoming-transfers')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Accept Transfer' }));

    expect(defaultProps.onAcceptTransfer).toHaveBeenCalled();
  });

  it('should display both incoming and outgoing when both exist', async function showBoth() {
    mockFetchResponses([mockOutgoingTransfer], [mockIncomingTransfer]);

    renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Outgoing Transfers')).toBeInTheDocument();
      expect(screen.getByText('Incoming Transfers')).toBeInTheDocument();
    });
  });

  it('should fall back to appId when app name not found', async function fallbackAppId() {
    useSitesStore.setState({ allSites: [] });
    mockFetchResponses([mockOutgoingTransfer]);

    renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('app-123')).toBeInTheDocument();
    });
  });

  it('should show both error messages when both fetches fail', async function fetchError() {
    vi.mocked(appFetch).mockRejectedValue(new Error('Network error'));

    renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load outgoing transfers.')).toBeInTheDocument();
      expect(screen.getByText('Failed to load incoming transfers.')).toBeInTheDocument();
    });
  });

  it('should show outgoing error when only outgoing fetch fails', async function partialOutgoingError() {
    vi.mocked(appFetch).mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('direction=incoming')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ transfers: [mockIncomingTransfer], total: 1, limit: 10, offset: 0 }),
        } as Response;
      }
      return { ok: false, status: 500, json: async () => ({ error: 'Server Error' }) } as Response;
    });

    renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load outgoing transfers.')).toBeInTheDocument();
    });

    expect(screen.queryByText('Failed to load incoming transfers.')).not.toBeInTheDocument();
    expect(screen.getByText('Incoming Transfers')).toBeInTheDocument();
  });

  it('should remove outgoing transfer after successful cancel', async function cancelTransfer() {
    vi.mocked(appFetch).mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/cancel')) {
        return { ok: true, status: 200, json: async () => ({ status: 'cancelled' }) } as Response;
      }
      if (typeof url === 'string' && url.includes('direction=incoming')) {
        return { ok: true, status: 200, json: async () => emptyList } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ transfers: [mockOutgoingTransfer], total: 1, limit: 10, offset: 0 }),
      } as Response;
    });

    const { user } = renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Test App')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByText('Test App')).not.toBeInTheDocument();
    });
  });

  it('should show error message when cancel fails', async function cancelError() {
    vi.mocked(appFetch).mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/cancel')) {
        return { ok: false, status: 400, json: async () => ({ error: 'CANCEL_FAILED' }) } as Response;
      }
      if (typeof url === 'string' && url.includes('direction=incoming')) {
        return { ok: true, status: 200, json: async () => emptyList } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ transfers: [mockOutgoingTransfer], total: 1, limit: 10, offset: 0 }),
      } as Response;
    });

    const { user } = renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Test App')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to cancel transfer. Please try again.')).toBeInTheDocument();
    });

    expect(screen.getByText('Test App')).toBeInTheDocument();
  });

  it('should show transfer count badges', async function countBadge() {
    const secondOutgoing = { ...mockOutgoingTransfer, id: 'tr-3', appId: 'app-789' };
    mockFetchResponses([mockOutgoingTransfer, secondOutgoing], [mockIncomingTransfer]);

    renderWithProviders(<PendingTransfers {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });
});
