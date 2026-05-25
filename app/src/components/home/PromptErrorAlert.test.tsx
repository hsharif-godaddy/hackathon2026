/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { PromptErrorAlert } from './PromptErrorAlert';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@ux/alert', () => ({
  default: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => (
    <div role="alert">
      {children}
      {actions}
    </div>
  ),
}));

vi.mock('@ux/button', () => ({
  default: ({
    text: textProp,
    onClick,
  }: {
    text?: string;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {textProp}
    </button>
  ),
}));

describe('PromptErrorAlert', () => {
  it('renders nothing when error is null', () => {
    const { container } = renderWithProviders(
      <PromptErrorAlert error={null} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the alert when error is provided', () => {
    renderWithProviders(
      <PromptErrorAlert error="Something went wrong" onDismiss={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('calls onDismiss when the dismiss button is clicked', async () => {
    const onDismiss = vi.fn();
    const { user } = renderWithProviders(
      <PromptErrorAlert error="An error" onDismiss={onDismiss} />,
    );
    await user.click(screen.getByRole('button', { name: 'builder_common_dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
