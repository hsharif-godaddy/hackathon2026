import '@testing-library/jest-dom';

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { appFetch } from '@/lib/gasket-config';
import { mockInstrumentation } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import TransferInitiateDialog from '../TransferInitiateDialog';

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

describe('TransferInitiateDialog', function dialogTests() {
  const defaultProps = {
    appId: 'app-123',
    appName: 'My Test App',
    onClose: vi.fn(),
    onTransferCreated: vi.fn(),
  };

  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  it('should render the input form', function renderForm() {
    renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    expect(screen.getByText('Transfer App')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeInTheDocument();
  });

  it('should show error for empty shopper ID', async function emptyShopperError() {
    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    const input = screen.getByRole('textbox');
    await user.type(input, ' ');
    await user.clear(input);

    const submitButton = screen.getByRole('button', { name: 'Transfer' });
    expect(submitButton).toBeDisabled();
  });

  it('should filter non-numeric characters from shopper ID input', async function filterNonNumeric() {
    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'abc123def456');

    expect(input).toHaveValue('123456');
  });

  it('should call API and show token on success', async function initiateSuccess() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transferToken: 'abc123', status: 'initiated' }),
    } as Response);

    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    const input = screen.getByRole('textbox');
    await user.type(input, '12345');

    const submitButton = screen.getByRole('button', { name: 'Transfer' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('abc123')).toBeInTheDocument();
    });

    expect(defaultProps.onTransferCreated).toHaveBeenCalledWith('abc123');
  });

  it('should show error message on API failure', async function initiateError() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Target shopper not found' }),
    } as Response);

    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), '99999');
    await user.click(screen.getByRole('button', { name: 'Transfer' }));

    await waitFor(() => {
      expect(screen.getByText('Target shopper not found')).toBeInTheDocument();
    });
  });

  it('should call onClose when cancel is clicked', async function cancelClose() {
    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
