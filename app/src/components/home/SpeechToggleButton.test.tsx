/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { mockBreakpoints } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import { SpeechToggleButton } from './SpeechToggleButton';

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => mockBreakpoints(),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (event: string) => `appbuilder.${event}.click`,
}));

vi.mock('@ux/icon/mic', () => ({
  default: () => <svg data-testid="mic-icon" />,
}));

vi.mock('@ux/button', () => ({
  default: ({
    onClick,
    disabled,
    'aria-label': ariaLabel,
    icon,
  }: {
    onClick?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
    icon?: React.ReactNode;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {icon}
    </button>
  ),
}));

describe('SpeechToggleButton', () => {
  it('has "Start voice input" aria-label when not listening', () => {
    renderWithProviders(
      <SpeechToggleButton
        isListening={false}
        isLoading={false}
        isTyping={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Start voice input' })).toBeInTheDocument();
  });

  it('has "Stop listening" aria-label when listening', () => {
    renderWithProviders(
      <SpeechToggleButton
        isListening={true}
        isLoading={false}
        isTyping={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument();
  });

  it('is disabled when isLoading is true', () => {
    renderWithProviders(
      <SpeechToggleButton
        isListening={false}
        isLoading={true}
        isTyping={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is disabled when isTyping is true', () => {
    renderWithProviders(
      <SpeechToggleButton
        isListening={false}
        isLoading={false}
        isTyping={true}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is enabled when neither loading nor typing', () => {
    renderWithProviders(
      <SpeechToggleButton
        isListening={false}
        isLoading={false}
        isTyping={false}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('calls onToggle when clicked', async () => {
    const onToggle = vi.fn();
    const { user } = renderWithProviders(
      <SpeechToggleButton
        isListening={false}
        isLoading={false}
        isTyping={false}
        onToggle={onToggle}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
