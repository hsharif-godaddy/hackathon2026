import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Chiclet } from '../Chiclet';

describe('Chiclet', () => {
  describe('render', () => {
    it('renders a button', () => {
      render(<Chiclet />);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('uses "Ask Airo" as the default accessible name', () => {
      render(<Chiclet />);
      expect(screen.getByRole('button', { name: 'Ask Airo' })).toBeInTheDocument();
    });

    it('renders the BEM root class on the button', () => {
      render(<Chiclet />);
      expect(screen.getByRole('button')).toHaveClass('airo-primitives-chiclet');
    });

    it('merges a consumer className with the BEM root class', () => {
      render(<Chiclet className="my-extra" />);
      const root = screen.getByRole('button');
      expect(root).toHaveClass('airo-primitives-chiclet');
      expect(root).toHaveClass('my-extra');
    });

    it('defaults type="button" so it does not submit the surrounding form', () => {
      // Submitting must be opt-in — a Chiclet inside a <form> shouldn't
      // accidentally trigger a submit when clicked.
      const onSubmit = vi.fn(function (e) { return e.preventDefault(); });
      render(
        <form onSubmit={onSubmit}>
          <Chiclet />
        </form>,
      );
      expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
    });

    it('respects an explicit type="submit"', () => {
      render(<Chiclet type="submit" />);
      expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
    });
  });

  describe('label', () => {
    it('uses provided children as the label', () => {
      render(<Chiclet>Try Airo</Chiclet>);
      expect(screen.getByRole('button', { name: 'Try Airo' })).toBeInTheDocument();
    });

    it('falls back to "Ask Airo" when children is an empty string', () => {
      // An explicitly empty label would ship a button with no accessible
      // name — fall back to the canonical default rather than ship one.
      render(<Chiclet>{''}</Chiclet>);
      expect(screen.getByRole('button', { name: 'Ask Airo' })).toBeInTheDocument();
    });

    it('falls back to "Ask Airo" when children is null', () => {
      render(<Chiclet>{null}</Chiclet>);
      expect(screen.getByRole('button', { name: 'Ask Airo' })).toBeInTheDocument();
    });

    it('renders rich label nodes', () => {
      render(
        <Chiclet>
          <span data-testid="rich">Rich label</span>
        </Chiclet>,
      );
      expect(screen.getByTestId('rich')).toBeInTheDocument();
    });
  });

  describe('icon slot', () => {
    it('renders the default wand icon when no icon prop is passed', () => {
      const { container } = render(<Chiclet />);
      const iconWrapper = container.querySelector('.airo-primitives-chiclet__icon');
      expect(iconWrapper).toBeInTheDocument();
      // The default wand glyph from `@ux/icon/async-icon.js` lazy-loads
      // its SVG, so we only assert that the icon slot is present and
      // marked aria-hidden — we don't assert on the SVG contents.
      expect(iconWrapper).toHaveAttribute('aria-hidden', 'true');
    });

    it('hides the icon slot entirely when icon={false}', () => {
      const { container } = render(<Chiclet icon={false} />);
      expect(container.querySelector('.airo-primitives-chiclet__icon')).not.toBeInTheDocument();
    });

    it('renders a custom icon node when provided', () => {
      const { container } = render(<Chiclet icon={<svg data-testid="custom-icon" />} />);
      expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
      // The custom icon still lives inside the aria-hidden wrapper so
      // screen readers don't double-announce it next to the label.
      const wrapper = container.querySelector('.airo-primitives-chiclet__icon');
      expect(wrapper).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('pure trigger semantics', () => {
    it('does not set aria-pressed by default', () => {
      // The chiclet is a pure trigger — no persistent "selected" state,
      // so it must not advertise toggle semantics it doesn't have. The
      // pressed visual is a CSS :active flash only.
      render(<Chiclet />);
      expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed');
    });

    it('does not set aria-checked by default', () => {
      render(<Chiclet />);
      expect(screen.getByRole('button')).not.toHaveAttribute('aria-checked');
    });
  });

  describe('size', () => {
    it('does not apply the --small modifier by default', () => {
      // Default size="medium" — the BEM convention is "no modifier means
      // default," so the small class must be absent.
      render(<Chiclet />);
      expect(screen.getByRole('button')).not.toHaveClass('airo-primitives-chiclet--small');
    });

    it('does not apply the --small modifier when size="medium" is explicit', () => {
      render(<Chiclet size="medium" />);
      expect(screen.getByRole('button')).not.toHaveClass('airo-primitives-chiclet--small');
    });

    it('applies the --small modifier when size="small"', () => {
      render(<Chiclet size="small" />);
      const root = screen.getByRole('button');
      // Both the BEM root AND the size modifier should be present so
      // base styles cascade and only the size-specific overrides apply.
      expect(root).toHaveClass('airo-primitives-chiclet');
      expect(root).toHaveClass('airo-primitives-chiclet--small');
    });

    it('preserves a consumer className alongside the size modifier', () => {
      render(<Chiclet size="small" className="my-extra" />);
      const root = screen.getByRole('button');
      expect(root).toHaveClass('airo-primitives-chiclet');
      expect(root).toHaveClass('airo-primitives-chiclet--small');
      expect(root).toHaveClass('my-extra');
    });
  });

  describe('theme partial', () => {
    it('applies data-partial="componentAiro" by default', () => {
      // The chiclet self-themes to ComponentAiro (Light) so its
      // `actionSecondary*` intents resolve to Airo-flavored values
      // (lavender hover, deep-purple pressed) regardless of the host
      // page's base theme.
      render(<Chiclet />);
      expect(screen.getByRole('button')).toHaveAttribute('data-partial', 'componentAiro');
    });

    it('lets a consumer override data-partial via spread', () => {
      // Consumers in an already-themed subtree (e.g. an inverted hero,
      // a dark mode partial) can opt out by passing their own
      // data-partial. The default is placed before the spread so it
      // loses to the consumer's value.
      render(<Chiclet data-partial="inverted" />);
      expect(screen.getByRole('button')).toHaveAttribute('data-partial', 'inverted');
    });
  });

  describe('interaction', () => {
    it('fires onClick when clicked', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();
      render(<Chiclet onClick={onClick} />);
      await user.click(screen.getByRole('button'));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('fires onClick when activated via Enter', async () => {
      // Keyboard activation is a baseline a11y requirement for a button-
      // shaped trigger; verify the native button surface still wires it.
      const onClick = vi.fn();
      const user = userEvent.setup();
      render(<Chiclet onClick={onClick} />);
      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard('{Enter}');
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('fires onClick when activated via Space', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();
      render(<Chiclet onClick={onClick} />);
      const button = screen.getByRole('button');
      button.focus();
      await user.keyboard(' ');
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not fire onClick when disabled', async () => {
      const onClick = vi.fn();
      const user = userEvent.setup();
      render(<Chiclet onClick={onClick} disabled />);
      await user.click(screen.getByRole('button'));
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('ref forwarding', () => {
    it('forwards a ref to the underlying button element', () => {
      // Refs matter for triggers — consumers often need to anchor a
      // popover/flyout to the chiclet's DOM node.
      const ref = createRef<HTMLButtonElement>();
      render(<Chiclet ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });
  });

  describe('prop forwarding', () => {
    it('forwards data-* attributes to the button', () => {
      render(<Chiclet data-testid="chiclet" />);
      expect(screen.getByTestId('chiclet')).toHaveAttribute('type', 'button');
    });

    it('forwards an explicit aria-label', () => {
      // Consumers may want to override the accessible name (e.g. the
      // visible label is iconographic) — aria-label should win as it
      // does on any standard button.
      render(<Chiclet aria-label="Open Airo">Ask</Chiclet>);
      expect(screen.getByRole('button', { name: 'Open Airo' })).toBeInTheDocument();
    });
  });
});
