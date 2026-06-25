import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ActionCard } from '../index';

describe('ActionCard', () => {
  it('renders a button named by its title, with a decorative icon', () => {
    render(<ActionCard icon={<span data-testid="glyph" />} title="Attach" />);
    const card: HTMLElement = screen.getByRole('button', { name: 'Attach' });
    expect(card).toBeInTheDocument();
    // The icon slot is aria-hidden so it does not double-announce alongside the title.
    expect(card.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByTestId('glyph')).toBeInTheDocument();
  });

  it('defaults to type="button" so it does not submit a surrounding form', () => {
    render(<ActionCard icon={<span />} title="Attach" />);
    expect(screen.getByRole('button', { name: 'Attach' })).toHaveAttribute('type', 'button');
  });

  it('applies the active modifier only when active', () => {
    const { rerender } = render(<ActionCard icon={<span />} title="Attach" />);
    expect(screen.getByRole('button', { name: 'Attach' }).className).not.toContain(
      'airo-primitives-action-card--active',
    );
    rerender(<ActionCard icon={<span />} title="Attach" active />);
    expect(screen.getByRole('button', { name: 'Attach' }).className).toContain(
      'airo-primitives-action-card--active',
    );
  });

  it('forwards onClick and native button attributes', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ActionCard icon={<span />} title="Attach" onClick={onClick} data-testid="attach" />);
    const card: HTMLElement = screen.getByTestId('attach');
    await user.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not fire onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ActionCard icon={<span />} title="Attach" onClick={onClick} disabled />);
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
