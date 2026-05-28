import { act, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Canvas } from '../Canvas';
import { CanvasStatus } from '../CanvasStatus';

describe('Canvas', () => {
  describe('render', () => {
    it('renders a <section> root with the BEM class', () => {
      const { container } = render(<Canvas>preview</Canvas>);
      const root = container.querySelector('section.airo-surfaces-canvas');
      expect(root).toBeInTheDocument();
    });

    it('renders children inside the body slot', () => {
      const { container } = render(<Canvas>hello</Canvas>);
      const body = container.querySelector('.airo-surfaces-canvas__body');
      expect(body).toHaveTextContent('hello');
    });

    it('omits the header slot when the prop is not provided', () => {
      const { container } = render(<Canvas>preview</Canvas>);
      expect(container.querySelector('.airo-surfaces-canvas__header')).not.toBeInTheDocument();
    });

    it('renders the header slot when the prop is provided', () => {
      const { container } = render(
        <Canvas header={<button type="button">tools</button>}>preview</Canvas>,
      );
      const header = container.querySelector('.airo-surfaces-canvas__header');
      expect(header).toBeInTheDocument();
      expect(header).toHaveTextContent('tools');
    });

    it('omits the status slot when the prop is null', () => {
      const { container } = render(<Canvas status={null}>preview</Canvas>);
      expect(container.querySelector('.airo-surfaces-canvas__status-slot')).not.toBeInTheDocument();
    });

    it('renders the status slot when the prop is provided', () => {
      const { container } = render(
        <Canvas status={<Canvas.Status label="Editing…" />}>preview</Canvas>,
      );
      expect(container.querySelector('.airo-surfaces-canvas__status-slot')).toBeInTheDocument();
      expect(screen.getByRole('status', { name: 'Editing…' })).toBeInTheDocument();
    });
  });

  describe('prop forwarding', () => {
    it('merges a consumer className with the BEM root class', () => {
      const { container } = render(<Canvas className="my-extra">preview</Canvas>);
      const root = container.querySelector('section');
      expect(root).toHaveClass('airo-surfaces-canvas');
      expect(root).toHaveClass('my-extra');
    });

    it('forwards data-* attributes to the root section', () => {
      render(
        <Canvas data-testid="canvas" aria-label="Site preview">
          preview
        </Canvas>,
      );
      const root = screen.getByTestId('canvas');
      expect(root.tagName.toLowerCase()).toBe('section');
      expect(root).toHaveAttribute('aria-label', 'Site preview');
    });

    it('forwards a ref to the underlying section element', () => {
      const ref = createRef<HTMLElement>();
      render(<Canvas ref={ref}>preview</Canvas>);
      expect(ref.current).toBeInstanceOf(HTMLElement);
      expect(ref.current?.tagName.toLowerCase()).toBe('section');
    });
  });

  describe('compound', () => {
    it('exposes Canvas.Status as a dot-notation alias for CanvasStatus', () => {
      expect(Canvas.Status).toBe(CanvasStatus);
    });
  });

  describe('at-viewport-bottom', () => {
    it('does not apply the modifier when the canvas is well above the viewport bottom', async () => {
      const { container } = render(<Canvas>preview</Canvas>);
      const root = container.querySelector('.airo-surfaces-canvas') as HTMLElement;
      vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
        bottom: 100,
        top: 0,
        left: 0,
        right: 0,
        width: 0,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      await act(async () => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(root).not.toHaveClass('airo-surfaces-canvas--at-viewport-bottom');
    });

    it('applies the modifier when the canvas bottom touches the viewport bottom', async () => {
      const { container } = render(<Canvas>preview</Canvas>);
      const root = container.querySelector('.airo-surfaces-canvas') as HTMLElement;
      vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
        bottom: window.innerHeight,
        top: 0,
        left: 0,
        right: 0,
        width: 0,
        height: window.innerHeight,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      await act(async () => {
        window.dispatchEvent(new Event('resize'));
      });
      await waitFor(() => {
        expect(root).toHaveClass('airo-surfaces-canvas--at-viewport-bottom');
      });
    });

    it('still applies the modifier when the canvas extends past the viewport bottom', async () => {
      const { container } = render(<Canvas>preview</Canvas>);
      const root = container.querySelector('.airo-surfaces-canvas') as HTMLElement;
      vi.spyOn(root, 'getBoundingClientRect').mockReturnValue({
        bottom: window.innerHeight + 200,
        top: 0,
        left: 0,
        right: 0,
        width: 0,
        height: window.innerHeight + 200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });
      await act(async () => {
        window.dispatchEvent(new Event('resize'));
      });
      await waitFor(() => {
        expect(root).toHaveClass('airo-surfaces-canvas--at-viewport-bottom');
      });
    });
  });

  describe('scroll fade', () => {
    it('renders an internal `__scroll` wrapper as the scroll container', () => {
      const { container } = render(<Canvas>preview</Canvas>);
      const scroll = container.querySelector('.airo-surfaces-canvas__scroll');
      expect(scroll).toBeInTheDocument();
      // Children render inside the scroll wrapper, not directly inside body.
      expect(scroll).toHaveTextContent('preview');
    });

    it('keeps the status slot as a sibling of `__scroll` (so it is not masked)', () => {
      const { container } = render(
        <Canvas status={<Canvas.Status label="Editing…" />}>preview</Canvas>,
      );
      const scroll = container.querySelector('.airo-surfaces-canvas__scroll');
      const statusSlot = container.querySelector('.airo-surfaces-canvas__status-slot');
      expect(scroll).toBeInTheDocument();
      expect(statusSlot).toBeInTheDocument();
      // Both share the same parent (`__body`) — the status slot must NOT
      // be a descendant of the masked scroll wrapper.
      expect(scroll?.parentElement).toBe(statusSlot?.parentElement);
      expect(scroll?.contains(statusSlot ?? null)).toBe(false);
    });

    it('has neither fade modifier class on initial render with non-overflowing content', () => {
      const { container } = render(<Canvas>preview</Canvas>);
      const scroll = container.querySelector('.airo-surfaces-canvas__scroll');
      expect(scroll).not.toHaveClass('airo-surfaces-canvas__scroll--faded-top');
      expect(scroll).not.toHaveClass('airo-surfaces-canvas__scroll--faded-bottom');
    });

    it('toggles `--faded-top` when the scroll wrapper is scrolled down', async () => {
      const { container } = render(<Canvas>preview</Canvas>);
      const scroll = container.querySelector('.airo-surfaces-canvas__scroll') as HTMLDivElement;
      // Simulate a scrollable region that has been scrolled down a bit.
      Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1000 });
      Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(scroll, 'scrollTop', { configurable: true, writable: true, value: 50 });
      await act(async () => {
        scroll.dispatchEvent(new Event('scroll'));
      });
      await waitFor(() => {
        expect(scroll).toHaveClass('airo-surfaces-canvas__scroll--faded-top');
      });
      expect(scroll).toHaveClass('airo-surfaces-canvas__scroll--faded-bottom');
    });

    it('clears `--faded-bottom` when scrolled to the end', async () => {
      const { container } = render(<Canvas>preview</Canvas>);
      const scroll = container.querySelector('.airo-surfaces-canvas__scroll') as HTMLDivElement;
      Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1000 });
      Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(scroll, 'scrollTop', {
        configurable: true,
        writable: true,
        value: 800,
      });
      await act(async () => {
        scroll.dispatchEvent(new Event('scroll'));
      });
      await waitFor(() => {
        expect(scroll).toHaveClass('airo-surfaces-canvas__scroll--faded-top');
      });
      expect(scroll).not.toHaveClass('airo-surfaces-canvas__scroll--faded-bottom');
    });

    it('does not apply fade classes when fadeOnScroll is false', async () => {
      const { container } = render(<Canvas fadeOnScroll={false}>preview</Canvas>);
      const scroll = container.querySelector('.airo-surfaces-canvas__scroll') as HTMLDivElement;
      Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1000 });
      Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 200 });
      Object.defineProperty(scroll, 'scrollTop', { configurable: true, writable: true, value: 50 });
      scroll.dispatchEvent(new Event('scroll'));
      await Promise.resolve();
      expect(scroll).not.toHaveClass('airo-surfaces-canvas__scroll--faded-top');
      expect(scroll).not.toHaveClass('airo-surfaces-canvas__scroll--faded-bottom');
    });
  });
});

describe('Canvas.Status', () => {
  describe('render', () => {
    it('renders a role="status" live region', () => {
      render(<Canvas.Status label="Editing…" />);
      expect(screen.getByRole('status', { name: 'Editing…' })).toBeInTheDocument();
    });

    it('renders the visible label inside the chip', () => {
      const { container } = render(<Canvas.Status label="Editing…" />);
      const labelEl = container.querySelector('.airo-surfaces-canvas-status__label');
      expect(labelEl).toHaveTextContent('Editing…');
    });

    it('renders the spinner-variant ThinkingIndicator inside the chip', () => {
      const { container } = render(<Canvas.Status label="Editing…" />);
      const indicator = container.querySelector('.airo-surfaces-canvas-status__indicator');
      expect(indicator).toHaveClass('airo-primitives-thinking-indicator--spinner');
    });

    it('hides the inner indicator from AT so the label is announced once', () => {
      const { container } = render(<Canvas.Status label="Editing…" />);
      // The chip's outer role="status" carries the visible label; the inner
      // indicator is aria-hidden to suppress its own live-region announcement.
      const indicator = container.querySelector('.airo-surfaces-canvas-status__indicator');
      expect(indicator).toHaveAttribute('aria-hidden', 'true');
    });

    it('applies the `componentAiro` data partial to the chip root', () => {
      const { container } = render(<Canvas.Status label="Editing…" />);
      const root = container.querySelector('.airo-surfaces-canvas-status');
      expect(root).toHaveAttribute('data-partial', 'componentAiro');
    });
  });

  describe('prop forwarding', () => {
    it('merges a consumer className with the BEM root class', () => {
      const { container } = render(<Canvas.Status label="Editing…" className="extra" />);
      const root = container.querySelector('.airo-surfaces-canvas-status');
      expect(root).toHaveClass('extra');
    });

    it('forwards data-* attributes to the root div', () => {
      render(<Canvas.Status label="Editing…" data-testid="chip" />);
      const root = screen.getByTestId('chip');
      expect(root).toHaveAttribute('role', 'status');
      // CanvasStatus is a `<Box>` (div) under the hood — switching to Box
      // gets us the standard `inlinePadding="md"` / `blockPadding="md"` /
      // `gap="sm"` knobs without hand-rolling padding declarations.
      expect(root.tagName.toLowerCase()).toBe('div');
    });

    it('forwards a ref to the underlying div element', () => {
      const ref = createRef<HTMLDivElement>();
      render(<Canvas.Status ref={ref} label="Editing…" />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });

    it('uses an explicit aria-label when label is a non-string node', () => {
      render(<Canvas.Status label={<span>Editing…</span>} aria-label="Editing your site" />);
      expect(screen.getByRole('status', { name: 'Editing your site' })).toBeInTheDocument();
    });
  });
});
