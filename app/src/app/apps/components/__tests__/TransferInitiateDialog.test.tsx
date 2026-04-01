/**
 * @vitest-environment jsdom
 */
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

    expect(screen.getByText(/Transfer \u201CMy Test App\u201D/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Code' })).toBeInTheDocument();
  });

  it('should show error for empty email', async function emptyEmailError() {
    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    const input = screen.getByRole('textbox');
    await user.type(input, ' ');
    await user.clear(input);

    const submitButton = screen.getByRole('button', { name: 'Generate Code' });
    expect(submitButton).toBeDisabled();
  });

  it('should show error for invalid email format', async function invalidEmailError() {
    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'notanemail');
    await user.click(screen.getByRole('button', { name: 'Generate Code' }));

    await waitFor(() => {
      expect(screen.getByText('Please enter a valid email address')).toBeInTheDocument();
    });

    expect(appFetch).not.toHaveBeenCalled();
  });

  it('should call API and show token on success', async function initiateSuccess() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-04-02T12:00:00.000Z' }),
    } as Response);

    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    const input = screen.getByRole('textbox');
    await user.type(input, 'ksutar@godaddy.com');

    const submitButton = screen.getByRole('button', { name: 'Generate Code' });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('abc123')).toBeInTheDocument();
    });

    // onTransferCreated is deferred until the user clicks Done
    expect(defaultProps.onTransferCreated).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(defaultProps.onTransferCreated).toHaveBeenCalledWith('abc123', '2026-04-02T12:00:00.000Z');
  });

  it('should show error message on API failure', async function initiateError() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Target email not found' }),
    } as Response);

    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'invalid@test.com');
    await user.click(screen.getByRole('button', { name: 'Generate Code' }));

    await waitFor(() => {
      expect(screen.getByText('Target email not found')).toBeInTheDocument();
    });
  });

  it('should call onClose when modal close is clicked', async function closeModal() {
    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    await user.click(screen.getByTestId('modal-close'));

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should call onTransferCreated and onClose when modal X is clicked on token step', async function closeOnTokenStep() {
    vi.mocked(appFetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ transferToken: 'abc123', status: 'initiated', expiresAt: '2026-04-02T12:00:00.000Z' }),
    } as Response);

    const { user } = renderWithProviders(<TransferInitiateDialog {...defaultProps} />);

    await user.type(screen.getByRole('textbox'), 'ksutar@godaddy.com');
    await user.click(screen.getByRole('button', { name: 'Generate Code' }));

    await waitFor(() => {
      expect(screen.getByText('abc123')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('modal-close'));

    expect(defaultProps.onTransferCreated).toHaveBeenCalledWith('abc123', '2026-04-02T12:00:00.000Z');
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
