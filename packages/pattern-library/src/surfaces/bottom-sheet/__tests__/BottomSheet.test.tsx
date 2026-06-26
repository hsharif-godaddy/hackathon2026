import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { BottomSheet } from '../index';

// `@ux/disrupt`'s internals do not render under the React 19 peers in jsdom
// (the same repo-wide tech debt that affects the Panel / FullscreenDialog
// suites). Mock it as a passthrough so we can exercise BottomSheet's own
// behavior — show/hide, scrim-tap close, a11y wiring, and slot rendering.
vi.mock('@ux/disrupt', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

// AsyncIcon dynamically imports its glyph and does not render under jsdom.
vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon }: { icon: string }) => <svg data-testid={`icon-${icon}`} />,
}));

/**
 * `<BottomSheet show />` mounts inside a Disrupt portal on `document.body`, so
 * we query inside `document.body` directly rather than the RTL container.
 */
function querySheet(): HTMLElement | null {
  return document.body.querySelector('.airo-surfaces-bottom-sheet__sheet');
}
function queryScrim(): HTMLElement | null {
  return document.body.querySelector('.airo-surfaces-bottom-sheet__scrim');
}

describe('BottomSheet', () => {
  describe('controlled vs uncontrolled', () => {
    it('does not render when uncontrolled and defaultShow is false', () => {
      render(<BottomSheet title="Actions">body</BottomSheet>);
      expect(querySheet()).toBeNull();
    });

    it('renders when defaultShow is true', () => {
      render(
        <BottomSheet defaultShow title="Actions">
          body
        </BottomSheet>,
      );
      expect(querySheet()).not.toBeNull();
    });

    it('honors the controlled `show` prop', () => {
      const { rerender } = render(
        <BottomSheet show={false} title="Actions">
          body
        </BottomSheet>,
      );
      expect(querySheet()).toBeNull();

      rerender(
        <BottomSheet show title="Actions">
          body
        </BottomSheet>,
      );
      expect(querySheet()).not.toBeNull();
    });

    it('does not self-close when controlled — consumer must update `show`', () => {
      const onClose = vi.fn();
      render(
        <BottomSheet show title="Actions" onClose={onClose}>
          body
        </BottomSheet>,
      );
      fireEvent.click(queryScrim() as HTMLElement);
      expect(onClose).toHaveBeenCalled();
      // Stays mounted because the consumer has not updated `show`.
      expect(querySheet()).not.toBeNull();
    });

    it('self-closes on scrim tap when uncontrolled', () => {
      render(
        <BottomSheet defaultShow title="Actions">
          body
        </BottomSheet>,
      );
      expect(querySheet()).not.toBeNull();
      fireEvent.click(queryScrim() as HTMLElement);
      expect(querySheet()).toBeNull();
    });

    it('closes on Escape', () => {
      const onClose = vi.fn();
      render(
        <BottomSheet defaultShow title="Actions" onClose={onClose}>
          body
        </BottomSheet>,
      );
      expect(querySheet()).not.toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
      expect(querySheet()).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('renders role=dialog + aria-modal', () => {
      render(
        <BottomSheet defaultShow title="Actions">
          body
        </BottomSheet>,
      );
      const sheet = querySheet();
      expect(sheet).toHaveAttribute('role', 'dialog');
      expect(sheet).toHaveAttribute('aria-modal', 'true');
    });

    it('wires a string title to aria-labelledby', () => {
      render(
        <BottomSheet defaultShow title="Actions">
          body
        </BottomSheet>,
      );
      const sheet = querySheet();
      const labelledBy = sheet?.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const titleEl = document.getElementById(labelledBy as string);
      expect(titleEl).toHaveTextContent('Actions');
    });

    it('prefers an explicit aria-labelledby over a string title', () => {
      render(
        <BottomSheet defaultShow title="Actions" aria-labelledby="external-heading">
          body
        </BottomSheet>,
      );
      expect(querySheet()).toHaveAttribute('aria-labelledby', 'external-heading');
    });

    it('falls back to aria-label when there is no string title', () => {
      render(
        <BottomSheet defaultShow aria-label="More actions">
          body
        </BottomSheet>,
      );
      expect(querySheet()).toHaveAttribute('aria-label', 'More actions');
    });
  });

  describe('content', () => {
    it('renders a dismiss (X) button that fires onClose', () => {
      const onClose = vi.fn();
      render(
        <BottomSheet defaultShow title="Actions" onClose={onClose}>
          body
        </BottomSheet>,
      );
      const closeButton = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeButton);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('omits the dismiss (X) button when showCloseButton is false', () => {
      render(
        <BottomSheet defaultShow title="Actions" showCloseButton={false}>
          body
        </BottomSheet>,
      );
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
      // Escape still closes — the sheet stays dismissible without the X.
      expect(querySheet()).not.toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(querySheet()).toBeNull();
    });

    it('omits the header entirely when there is no title and no close button', () => {
      render(
        <BottomSheet defaultShow aria-label="Publish" showCloseButton={false}>
          <span data-testid="sheet-body">body</span>
        </BottomSheet>,
      );
      expect(document.body.querySelector('.airo-surfaces-bottom-sheet__header')).toBeNull();
      // The sheet + body still render; the drag handle remains as the affordance.
      expect(querySheet()).not.toBeNull();
      expect(screen.getByTestId('sheet-body')).toBeInTheDocument();
      expect(
        document.body.querySelector('.airo-surfaces-bottom-sheet__drag-handle'),
      ).not.toBeNull();
    });

    it('still renders the header when a title is present but the close button is hidden', () => {
      render(
        <BottomSheet defaultShow title="Publish" showCloseButton={false}>
          body
        </BottomSheet>,
      );
      expect(document.body.querySelector('.airo-surfaces-bottom-sheet__header')).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    });

    it('renders a decorative (aria-hidden) drag handle', () => {
      render(
        <BottomSheet defaultShow title="Actions">
          body
        </BottomSheet>,
      );
      const handle: HTMLElement | null = document.body.querySelector(
        '.airo-surfaces-bottom-sheet__drag-handle',
      );
      expect(handle).not.toBeNull();
      expect(handle).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders children in the scrollable body', () => {
      render(
        <BottomSheet defaultShow title="Actions">
          <span data-testid="sheet-body">hello</span>
        </BottomSheet>,
      );
      expect(screen.getByTestId('sheet-body')).toHaveTextContent('hello');
    });
  });
});
