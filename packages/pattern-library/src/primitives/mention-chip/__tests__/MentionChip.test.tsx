import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { MentionChip } from '../MentionChip';

vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon, ...rest }: { icon: string } & Record<string, unknown>) => (
    <svg data-testid={`async-icon-${icon}`} data-icon={icon} {...rest} />
  ),
}));

describe('MentionChip', () => {
  describe('render', () => {
    it('renders a span with role="button" when onActivate is provided', () => {
      // The chip body is a span, not a real button, because it can host
      // a real <button> for remove and nested buttons are invalid HTML.
      // The role-on-span only kicks in when the chip is interactive.
      render(<MentionChip label="Button" onActivate={() => {}} />);
      const chip = screen.getByRole('button', { name: /button/i });
      expect(chip.tagName).toBe('SPAN');
    });

    it('renders the BEM root class', () => {
      const { container } = render(<MentionChip label="Button" />);
      const chip = container.querySelector('.airo-primitives-mention-chip') as HTMLElement;
      expect(chip).toBeInTheDocument();
      expect(chip).toHaveClass('airo-primitives-mention-chip');
    });

    it('merges a consumer className with the BEM root class', () => {
      const { container } = render(<MentionChip label="Button" className="my-extra" />);
      const chip = container.querySelector('.airo-primitives-mention-chip') as HTMLElement;
      expect(chip).toHaveClass('airo-primitives-mention-chip');
      expect(chip).toHaveClass('my-extra');
    });

    it('marks the chip body contentEditable={false} for atomic editor behaviour', () => {
      const { container } = render(<MentionChip label="Button" />);
      const chip = container.querySelector('.airo-primitives-mention-chip') as HTMLElement;
      expect(chip).toHaveAttribute('contenteditable', 'false');
    });

    it('exposes tabIndex=0 only when the chip is activatable', () => {
      // A read-only chip (no onActivate, no onRemove) must not be a
      // phantom focusable element — there's nothing for AT users to
      // activate, so it should not appear in the focus order at all.
      const { container, rerender } = render(<MentionChip label="Button" />);
      const chip = container.querySelector('.airo-primitives-mention-chip') as HTMLElement;
      expect(chip).not.toHaveAttribute('tabindex');
      expect(chip).not.toHaveAttribute('role');

      rerender(<MentionChip label="Button" onActivate={() => {}} />);
      expect(chip).toHaveAttribute('tabindex', '0');
      expect(chip).toHaveAttribute('role', 'button');
    });
  });

  describe('prefix', () => {
    it('renders the prefix with a leading # glyph', () => {
      render(<MentionChip prefix={1} label="Button" />);
      // The component prepends the literal `#`, so callers pass just the
      // value (e.g. `prefix={1}`) not `prefix="#1"`.
      expect(screen.getByText('#1')).toBeInTheDocument();
    });

    it('marks the prefix with the BEM __prefix class', () => {
      render(<MentionChip prefix={1} label="Button" />);
      const prefix = screen.getByText('#1');
      expect(prefix).toHaveClass('airo-primitives-mention-chip__prefix');
    });

    it('omits the prefix span when prefix is undefined', () => {
      const { container } = render(<MentionChip label="Pinned note" />);
      expect(
        container.querySelector('.airo-primitives-mention-chip__prefix'),
      ).not.toBeInTheDocument();
    });

    it('omits the prefix span when prefix is an empty string', () => {
      const { container } = render(<MentionChip prefix="" label="Pinned note" />);
      expect(
        container.querySelector('.airo-primitives-mention-chip__prefix'),
      ).not.toBeInTheDocument();
    });

    it('omits the prefix span when prefix is null', () => {
      const { container } = render(<MentionChip prefix={null} label="Pinned note" />);
      expect(
        container.querySelector('.airo-primitives-mention-chip__prefix'),
      ).not.toBeInTheDocument();
    });
  });

  describe('label', () => {
    it('renders an icon when icon prop is provided', () => {
      render(<MentionChip icon="code" label="Code" />);
      expect(screen.getByTestId('async-icon-code')).toBeInTheDocument();
    });

    it('does not render an icon slot when icon is omitted', () => {
      const { container } = render(<MentionChip label="Button" />);
      expect(
        container.querySelector('.airo-primitives-mention-chip__icon'),
      ).not.toBeInTheDocument();
    });

    it('renders the label inside the BEM __label span', () => {
      render(<MentionChip label="Button" />);
      const label = screen.getByText('Button');
      expect(label).toHaveClass('airo-primitives-mention-chip__label');
    });

    it('renders rich label nodes', () => {
      render(<MentionChip label={<span data-testid="rich">Hero section</span>} />);
      expect(screen.getByTestId('rich')).toBeInTheDocument();
    });
  });

  describe('onActivate', () => {
    it('fires onActivate on click', async () => {
      const onActivate = vi.fn();
      const user = userEvent.setup();
      render(<MentionChip label="Button" onActivate={onActivate} />);
      await user.click(screen.getByRole('button', { name: /button/i }));
      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('fires onActivate on Enter', async () => {
      const onActivate = vi.fn();
      const user = userEvent.setup();
      render(<MentionChip label="Button" onActivate={onActivate} />);
      const chip = screen.getByRole('button', { name: /button/i });
      chip.focus();
      await user.keyboard('{Enter}');
      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('fires onActivate on Space', async () => {
      const onActivate = vi.fn();
      const user = userEvent.setup();
      render(<MentionChip label="Button" onActivate={onActivate} />);
      const chip = screen.getByRole('button', { name: /button/i });
      chip.focus();
      await user.keyboard(' ');
      expect(onActivate).toHaveBeenCalledTimes(1);
    });

    it('does not fire onActivate when the remove button is clicked', async () => {
      // The two affordances must stay independent — clicking remove
      // should never look like an activate to the call site.
      const onActivate = vi.fn();
      const onRemove = vi.fn();
      const user = userEvent.setup();
      render(<MentionChip label="Button" onActivate={onActivate} onRemove={onRemove} />);
      await user.click(screen.getByRole('button', { name: /remove/i }));
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onActivate).not.toHaveBeenCalled();
    });

    it('is a no-op when onActivate is not provided (read-only chip)', () => {
      // Read-only chips (e.g. a static reference inside body text) drop
      // role/tabindex so they're not phantom focusable elements — there's
      // nothing for AT users to activate, so the chip should not appear in
      // the focus order at all.
      const { container } = render(<MentionChip label="Button" />);
      const chip = container.querySelector('.airo-primitives-mention-chip') as HTMLElement;
      expect(chip).not.toHaveAttribute('role');
      expect(chip).not.toHaveAttribute('tabindex');
    });
  });

  describe('onRemove', () => {
    it('does not render a remove button when onRemove is omitted', () => {
      render(<MentionChip label="Button" />);
      // Read-only chip — no chip-body button role, no remove button.
      expect(screen.queryAllByRole('button')).toHaveLength(0);
    });

    it('renders only the remove button when onActivate is omitted', () => {
      render(<MentionChip label="Button" onRemove={() => {}} />);
      // The chip body itself isn't activatable, so only the remove button
      // is in the focus order.
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
    });

    it('renders a remove button when onRemove is provided', () => {
      render(<MentionChip label="Button" onRemove={() => {}} />);
      expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    });

    it('uses a custom removeLabel when provided', () => {
      render(<MentionChip label="Button" onRemove={() => {}} removeLabel="Quitar" />);
      expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument();
    });

    it('fires onRemove when the remove button is clicked', async () => {
      const onRemove = vi.fn();
      const user = userEvent.setup();
      render(<MentionChip label="Button" onRemove={onRemove} />);
      await user.click(screen.getByRole('button', { name: /remove/i }));
      expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('fires onRemove when the remove button is activated via Enter', async () => {
      const onRemove = vi.fn();
      const user = userEvent.setup();
      render(<MentionChip label="Button" onRemove={onRemove} />);
      screen.getByRole('button', { name: /remove/i }).focus();
      await user.keyboard('{Enter}');
      expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('renders the remove button as a real <button type="button">', () => {
      // Native button so keyboard activation, focus, and AT semantics
      // are free. Type=button so a chip rendered inside a <form> never
      // accidentally submits it.
      render(<MentionChip label="Button" onRemove={() => {}} />);
      const remove = screen.getByRole('button', { name: /remove/i });
      expect(remove.tagName).toBe('BUTTON');
      expect(remove).toHaveAttribute('type', 'button');
    });
  });

  describe('pure trigger semantics', () => {
    it('does not set aria-pressed on the chip body', () => {
      render(<MentionChip label="Button" onActivate={() => {}} />);
      const chip = screen.getByRole('button', { name: /button/i });
      expect(chip).not.toHaveAttribute('aria-pressed');
    });

    it('does not set aria-checked on the chip body', () => {
      render(<MentionChip label="Button" onActivate={() => {}} />);
      const chip = screen.getByRole('button', { name: /button/i });
      expect(chip).not.toHaveAttribute('aria-checked');
    });
  });

  describe('ref forwarding', () => {
    it('forwards a ref to the underlying span element', () => {
      const ref = createRef<HTMLSpanElement>();
      render(<MentionChip label="Button" ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLSpanElement);
      expect(ref.current).toHaveClass('airo-primitives-mention-chip');
    });
  });

  describe('prop forwarding', () => {
    it('forwards data-* attributes to the chip body', () => {
      render(<MentionChip label="Button" data-testid="chip" />);
      expect(screen.getByTestId('chip')).toHaveClass('airo-primitives-mention-chip');
    });

    it('forwards an explicit aria-label that overrides the visible label', () => {
      render(<MentionChip label="Button" aria-label="Open Button #1" onActivate={() => {}} />);
      expect(screen.getByRole('button', { name: 'Open Button #1' })).toBeInTheDocument();
    });

    it('respects a consumer onClick handler that calls preventDefault', async () => {
      // If a consumer's onClick preventDefaults, the chip should treat
      // that as "the consumer handled it" and skip onActivate.
      const onActivate = vi.fn();
      const onClick = vi.fn(function (e) { return e.preventDefault(); });
      const user = userEvent.setup();
      render(<MentionChip label="Button" onActivate={onActivate} onClick={onClick} />);
      await user.click(screen.getByRole('button', { name: /button/i }));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onActivate).not.toHaveBeenCalled();
    });
  });
});
