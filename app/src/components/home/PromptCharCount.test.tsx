/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { MAX_PROMPT_BYTES } from '@/lib/waf-validation';
import { renderWithProviders } from '@/tests/test-utils';
import { PromptCharCount } from './PromptCharCount';

const enNumberFormat = new Intl.NumberFormat('en');

vi.mock('@ux/text', () => ({
  text: {
    p: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <p className={className}>{children}</p>
    ),
  },
}));

describe('PromptCharCount', () => {
  it('renders the wrapper but hides counter when bytesRemaining is above threshold', () => {
    renderWithProviders(<PromptCharCount bytesRemaining={21} isOverLimit={false} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('21')).not.toBeInTheDocument();
  });

  it('renders when bytesRemaining is at the threshold (20)', () => {
    renderWithProviders(<PromptCharCount bytesRemaining={20} isOverLimit={false} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders when bytesRemaining is below threshold', () => {
    renderWithProviders(<PromptCharCount bytesRemaining={10} isOverLimit={false} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows the remaining byte count in the visible span', () => {
    renderWithProviders(<PromptCharCount bytesRemaining={15} isOverLimit={false} />);
    expect(
      screen.getByText(`${enNumberFormat.format(15)} / ${enNumberFormat.format(MAX_PROMPT_BYTES)}`)
    ).toBeInTheDocument();
  });

  it('shows negative count prefixed with minus when over limit', () => {
    renderWithProviders(<PromptCharCount bytesRemaining={-5} isOverLimit={true} />);
    expect(
      screen.getByText(`${enNumberFormat.format(-5)} / ${enNumberFormat.format(MAX_PROMPT_BYTES)}`)
    ).toBeInTheDocument();
  });

  it('announces remaining count and max in the screen reader text', () => {
    renderWithProviders(<PromptCharCount bytesRemaining={15} isOverLimit={false} />);
    expect(
      screen.getByText(
        `${enNumberFormat.format(15)} of ${enNumberFormat.format(MAX_PROMPT_BYTES)} characters remaining`
      )
    ).toBeInTheDocument();
  });

  it('announces over-limit count and max in the screen reader text', () => {
    renderWithProviders(<PromptCharCount bytesRemaining={-5} isOverLimit={true} />);
    expect(
      screen.getByText(
        `${enNumberFormat.format(5)} over the ${enNumberFormat.format(MAX_PROMPT_BYTES)} character limit`
      )
    ).toBeInTheDocument();
  });

  it('has aria-live="polite" for screen reader announcements', () => {
    renderWithProviders(<PromptCharCount bytesRemaining={10} isOverLimit={false} />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
