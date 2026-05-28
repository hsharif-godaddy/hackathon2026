import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TokenBudgetButton } from '../TokenBudgetButton';

describe('TokenBudgetButton', () => {
  it('renders with aria-label and componentAiro partial', () => {
    const { container } = render(
      <TokenBudgetButton
        percent={55}
        aria-label="55 percent of token budget remaining"
        onPress={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: '55 percent of token budget remaining' }),
    ).toBeInTheDocument();
    const wrap = container.querySelector('.airo-input-prompt-box__token-budget');
    expect(wrap).toHaveAttribute('data-partial', 'componentAiro');
  });

  it('is disabled until onPress is provided', () => {
    render(<TokenBudgetButton percent={40} aria-label="Token budget" />);
    expect(screen.getByRole('button', { name: 'Token budget' })).toBeDisabled();
  });

  it('respects disabled when onPress is set', () => {
    render(<TokenBudgetButton percent={10} aria-label="Token budget" onPress={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Token budget' })).toBeDisabled();
  });

  it('applies the emphasis modifier class and drops the componentAiro partial', () => {
    const { container } = render(
      <TokenBudgetButton
        percent={8}
        aria-label="Token budget low"
        onPress={vi.fn()}
        emphasis="critical"
      />,
    );
    const wrap = container.querySelector('.airo-input-prompt-box__token-budget');
    expect(wrap).toHaveClass('airo-input-prompt-box__token-budget--emphasis-critical');
    expect(wrap).not.toHaveAttribute('data-partial');
  });

  it('omits the emphasis modifier class by default', () => {
    const { container } = render(
      <TokenBudgetButton percent={50} aria-label="Token budget" onPress={vi.fn()} />,
    );
    const wrap = container.querySelector('.airo-input-prompt-box__token-budget');
    expect(wrap?.className).not.toMatch(/--emphasis-/);
  });
});
