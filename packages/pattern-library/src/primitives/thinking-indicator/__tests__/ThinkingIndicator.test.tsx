import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ThinkingIndicator, type ThinkingIndicatorVariant } from '../ThinkingIndicator';

describe('ThinkingIndicator', () => {
  describe('render', () => {
    it('renders without crashing', () => {
      render(<ThinkingIndicator />);
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('renders three dot spans', () => {
      const { container } = render(<ThinkingIndicator />);
      const dots = container.querySelectorAll('.airo-primitives-thinking-indicator__dot');
      expect(dots).toHaveLength(3);
    });

    it('applies the BEM root class', () => {
      render(<ThinkingIndicator />);
      expect(screen.getByRole('status')).toHaveClass('airo-primitives-thinking-indicator');
    });

    it('merges a consumer className with the BEM root class', () => {
      render(<ThinkingIndicator className="my-extra" />);
      const root = screen.getByRole('status');
      expect(root).toHaveClass('airo-primitives-thinking-indicator');
      expect(root).toHaveClass('my-extra');
    });
  });

  describe('aria-label', () => {
    it('defaults to "Loading"', () => {
      render(<ThinkingIndicator />);
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    });

    it('uses the provided label prop', () => {
      render(<ThinkingIndicator label="Generating a response" />);
      expect(screen.getByRole('status', { name: 'Generating a response' })).toBeInTheDocument();
    });

    it('falls back to "Loading" when label is an empty string', () => {
      render(<ThinkingIndicator label="" />);
      expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    });

    it('consumer-passed `aria-label` overrides the default and reaches the live region', () => {
      const { container } = render(<ThinkingIndicator aria-label="Saving draft" />);
      const root = screen.getByRole('status', { name: 'Saving draft' });
      expect(root).toBeInTheDocument();
      // Live-region SR-only text mirrors the aria-label so screen readers
      // that announce text content (rather than the accessible name)
      // surface the same string.
      const srOnly = container.querySelector('.airo-primitives-thinking-indicator__sr-only');
      expect(srOnly).toHaveTextContent('Saving draft');
    });

    it('consumer-passed `aria-label` overrides the `label` prop value', () => {
      const { container } = render(
        <ThinkingIndicator label="Generating" aria-label="Saving draft" />,
      );
      expect(screen.getByRole('status', { name: 'Saving draft' })).toBeInTheDocument();
      const srOnly = container.querySelector('.airo-primitives-thinking-indicator__sr-only');
      expect(srOnly).toHaveTextContent('Saving draft');
    });
  });

  describe('dot BEM modifiers', () => {
    it('applies --1, --2, --3 modifier classes to the three dots', () => {
      const { container } = render(<ThinkingIndicator />);
      expect(
        container.querySelector('.airo-primitives-thinking-indicator__dot--1'),
      ).toBeInTheDocument();
      expect(
        container.querySelector('.airo-primitives-thinking-indicator__dot--2'),
      ).toBeInTheDocument();
      expect(
        container.querySelector('.airo-primitives-thinking-indicator__dot--3'),
      ).toBeInTheDocument();
    });
  });

  describe('prop forwarding', () => {
    it('forwards data-* attributes to the root span', () => {
      render(<ThinkingIndicator data-testid="dots" />);
      expect(screen.getByTestId('dots')).toHaveAttribute('role', 'status');
    });
  });

  describe('variant', () => {
    it('defaults to "dots" — renders three dot spans, no spinner', () => {
      const { container } = render(<ThinkingIndicator />);
      expect(container.querySelectorAll('.airo-primitives-thinking-indicator__dot')).toHaveLength(
        3,
      );
      expect(
        container.querySelector('.airo-primitives-thinking-indicator__spinner'),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveClass('airo-primitives-thinking-indicator--dots');
    });

    it('"spinner" variant renders an SVG spinner, no dots', () => {
      const { container } = render(<ThinkingIndicator variant="spinner" />);
      const spinner = container.querySelector('.airo-primitives-thinking-indicator__spinner');
      expect(spinner).toBeInTheDocument();
      expect(spinner?.tagName.toLowerCase()).toBe('svg');
      expect(container.querySelectorAll('.airo-primitives-thinking-indicator__dot')).toHaveLength(
        0,
      );
      expect(screen.getByRole('status')).toHaveClass('airo-primitives-thinking-indicator--spinner');
    });

    it('spinner variant keeps the same a11y surface (status role + accessible name)', () => {
      render(<ThinkingIndicator variant="spinner" label="Editing your site" />);
      expect(screen.getByRole('status', { name: 'Editing your site' })).toBeInTheDocument();
    });

    it('spinner SVG is aria-hidden so the live-region label is the only announcement', () => {
      const { container } = render(<ThinkingIndicator variant="spinner" />);
      const spinner = container.querySelector('.airo-primitives-thinking-indicator__spinner');
      expect(spinner).toHaveAttribute('aria-hidden', 'true');
    });

    it('spinner variant respects the size multiplier', () => {
      render(<ThinkingIndicator variant="spinner" size={0.6} />);
      const root = screen.getByRole('status');
      expect(
        root.style.getPropertyValue('--airo-primitives-thinking-indicator-size-multiplier'),
      ).toBe('0.6');
    });

    it('spinner variant defaults to a compact 0.75 multiplier when size is not provided', () => {
      render(<ThinkingIndicator variant="spinner" />);
      const root = screen.getByRole('status');
      expect(
        root.style.getPropertyValue('--airo-primitives-thinking-indicator-size-multiplier'),
      ).toBe('0.75');
    });

    it('dots variant does not set the size multiplier custom property at the default size', () => {
      render(<ThinkingIndicator />);
      const root = screen.getByRole('status');
      expect(
        root.style.getPropertyValue('--airo-primitives-thinking-indicator-size-multiplier'),
      ).toBe('');
    });

    it('"godaddy" variant renders the brand-mark SVG inside a stage with a pulse ring, no dots, no spinner', () => {
      const { container } = render(<ThinkingIndicator variant="godaddy" />);
      const stage = container.querySelector('.airo-primitives-thinking-indicator__logo-stage');
      const logo = container.querySelector('.airo-primitives-thinking-indicator__logo');
      const pulseRing = container.querySelector('.airo-primitives-thinking-indicator__pulse-ring');
      expect(stage).toBeInTheDocument();
      expect(logo).toBeInTheDocument();
      expect(logo?.tagName.toLowerCase()).toBe('svg');
      expect(pulseRing).toBeInTheDocument();
      expect(stage?.contains(logo)).toBe(true);
      expect(stage?.contains(pulseRing)).toBe(true);
      expect(container.querySelectorAll('.airo-primitives-thinking-indicator__dot')).toHaveLength(
        0,
      );
      expect(
        container.querySelector('.airo-primitives-thinking-indicator__spinner'),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveClass('airo-primitives-thinking-indicator--godaddy');
    });

    it('godaddy stage is aria-hidden so the pulse ring + mark do not double-announce', () => {
      const { container } = render(<ThinkingIndicator variant="godaddy" />);
      const stage = container.querySelector('.airo-primitives-thinking-indicator__logo-stage');
      expect(stage).toHaveAttribute('aria-hidden', 'true');
    });

    it('godaddy variant keeps the same a11y surface (status role + accessible name)', () => {
      render(<ThinkingIndicator variant="godaddy" label="Generating with AI" />);
      expect(screen.getByRole('status', { name: 'Generating with AI' })).toBeInTheDocument();
    });

    it('godaddy SVG is aria-hidden so the live-region label is the only announcement', () => {
      const { container } = render(<ThinkingIndicator variant="godaddy" />);
      const logo = container.querySelector('.airo-primitives-thinking-indicator__logo');
      expect(logo).toHaveAttribute('aria-hidden', 'true');
    });

    it('godaddy variant respects the size multiplier', () => {
      render(<ThinkingIndicator variant="godaddy" size={0.6} />);
      const root = screen.getByRole('status');
      expect(
        root.style.getPropertyValue('--airo-primitives-thinking-indicator-size-multiplier'),
      ).toBe('0.6');
    });

    it('"thinking-daddy" variant renders the mascot SVG, no dots, no spinner', () => {
      const { container } = render(<ThinkingIndicator variant="thinking-daddy" />);
      const mascot = container.querySelector(
        '.airo-primitives-thinking-indicator__thinking-daddy',
      );
      expect(mascot).toBeInTheDocument();
      expect(mascot?.tagName.toLowerCase()).toBe('svg');
      expect(container.querySelectorAll('.airo-primitives-thinking-indicator__dot')).toHaveLength(
        0,
      );
      expect(
        container.querySelector('.airo-primitives-thinking-indicator__spinner'),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveClass(
        'airo-primitives-thinking-indicator--thinking-daddy',
      );
    });

    it('thinking-daddy SVG is aria-hidden so the live-region label is the only announcement', () => {
      const { container } = render(<ThinkingIndicator variant="thinking-daddy" />);
      const mascot = container.querySelector(
        '.airo-primitives-thinking-indicator__thinking-daddy',
      );
      expect(mascot).toHaveAttribute('aria-hidden', 'true');
    });

    it('thinking-daddy variant keeps the same a11y surface (status role + accessible name)', () => {
      render(<ThinkingIndicator variant="thinking-daddy" label="Thinking…" />);
      expect(screen.getByRole('status', { name: 'Thinking…' })).toBeInTheDocument();
    });

    it('thinking-daddy variant respects the size multiplier', () => {
      render(<ThinkingIndicator variant="thinking-daddy" size={0.6} />);
      const root = screen.getByRole('status');
      expect(
        root.style.getPropertyValue('--airo-primitives-thinking-indicator-size-multiplier'),
      ).toBe('0.6');
    });

    it('falls back to the bouncing-dots variant when given an unknown variant', () => {
      const { container } = render(
        // Cast to `ThinkingIndicatorVariant` to simulate an unrecognized
        // runtime value (e.g. a future-removed variant or an older consumer
        // pinned to a value the current package no longer ships). Casting
        // to the union (rather than a single literal like `'dots'`) reads
        // as "any value typed as the variant prop" without misrepresenting
        // the runtime payload.
        <ThinkingIndicator variant={'wave' as ThinkingIndicatorVariant} />,
      );
      expect(container.querySelectorAll('.airo-primitives-thinking-indicator__dot')).toHaveLength(
        3,
      );
      expect(
        container.querySelector('.airo-primitives-thinking-indicator__spinner'),
      ).not.toBeInTheDocument();
      const root = screen.getByRole('status');
      expect(root).toHaveClass('airo-primitives-thinking-indicator--dots');
      expect(root).not.toHaveClass('airo-primitives-thinking-indicator--wave');
    });
  });
});
