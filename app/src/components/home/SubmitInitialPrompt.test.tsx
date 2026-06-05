/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { mockBreakpoints } from '@/tests/mocks';
import { renderWithProviders } from '@/tests/test-utils';
import { SubmitInitialPrompt } from './SubmitInitialPrompt';

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => mockBreakpoints(),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: (event: string) => `appbuilder.${event}.click`,
}));

vi.mock('@ux/spinner', () => ({
  default: () => <div data-testid="spinner" />,
}));

vi.mock('@ux/button', () => ({
  default: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
    icon,
    text,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
    icon?: React.ReactNode;
    text?: React.ReactNode;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {icon}
      {text}
      {children}
    </button>
  ),
}));

describe('SubmitInitialPrompt', () => {
  it('is disabled when disabled prop is true', () => {
    renderWithProviders(
      <SubmitInitialPrompt onClick={vi.fn()} disabled={true} isLoading={false} />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is enabled when disabled prop is false', () => {
    renderWithProviders(
      <SubmitInitialPrompt onClick={vi.fn()} disabled={false} isLoading={false} />,
    );
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('shows spinner when isLoading is true', () => {
    renderWithProviders(
      <SubmitInitialPrompt
        onClick={vi.fn()}
        disabled={false}
        isLoading={true}
        icon={<svg data-testid="send-icon" />}
      />,
    );
    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('send-icon')).not.toBeInTheDocument();
  });

  it('shows icon when isLoading is false', () => {
    renderWithProviders(
      <SubmitInitialPrompt
        onClick={vi.fn()}
        disabled={false}
        isLoading={false}
        icon={<svg data-testid="send-icon" />}
      />,
    );
    expect(screen.getByTestId('send-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <SubmitInitialPrompt onClick={onClick} disabled={false} isLoading={false} />,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders text inside the button', () => {
    renderWithProviders(
      <SubmitInitialPrompt
        onClick={vi.fn()}
        disabled={false}
        isLoading={false}
        text="Submit"
      />,
    );
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('has loading aria-label when isLoading', () => {
    renderWithProviders(
      <SubmitInitialPrompt onClick={vi.fn()} disabled={false} isLoading={true} />,
    );
    expect(
      screen.getByRole('button', { name: 'builder_homepage_hero_prompt_button_loading' }),
    ).toBeInTheDocument();
  });

  it('has default aria-label when not loading', () => {
    renderWithProviders(
      <SubmitInitialPrompt onClick={vi.fn()} disabled={false} isLoading={false} />,
    );
    expect(
      screen.getByRole('button', { name: 'builder_homepage_hero_prompt_button' }),
    ).toBeInTheDocument();
  });
});
