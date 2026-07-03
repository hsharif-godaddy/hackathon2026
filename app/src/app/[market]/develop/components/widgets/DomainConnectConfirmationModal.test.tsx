/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { DomainConnectConfirmationModal } from './DomainConnectConfirmationModal';

vi.mock('@ux/modal', () => ({
  default: function Modal({ children }: { children: ReactNode }) {
    return <div data-testid='mock-modal'>{children}</div>;
  },
}));

describe('DomainConnectConfirmationModal', () => {
  const onClose = vi.fn();
  const onConfirm = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    renderWithProviders(
      <DomainConnectConfirmationModal isOpen={false} isConnecting={false} onClose={onClose} onConfirm={onConfirm} />,
    );
    expect(screen.queryByTestId('mock-modal')).not.toBeInTheDocument();
  });

  it('renders the confirmation and fires callbacks when open', () => {
    renderWithProviders(
      <DomainConnectConfirmationModal isOpen isConnecting={false} onClose={onClose} onConfirm={onConfirm} />,
    );
    expect(screen.getByText('builder_domain_connect_confirmation_description')).toBeInTheDocument();

    fireEvent.click(screen.getByText('builder_custom_domain_modal_button_continue'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('builder_custom_domain_modal_button_cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows connecting text and disables both actions while connecting', () => {
    renderWithProviders(
      <DomainConnectConfirmationModal isOpen isConnecting onClose={onClose} onConfirm={onConfirm} />,
    );
    expect(screen.getByText('builder_domain_attach_connecting')).toBeInTheDocument();

    const buttons: HTMLElement[] = screen.getAllByRole('button');
    buttons.forEach((button) => expect(button).toBeDisabled());

    fireEvent.click(screen.getByText('builder_domain_attach_connecting'));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
