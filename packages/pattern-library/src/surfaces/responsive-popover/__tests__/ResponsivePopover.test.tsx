import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ResponsivePopover, type ResponsivePopoverTriggerArgs } from '../index';

// `@ux/disrupt` (used by the mobile BottomSheet) does not render under the
// React 19 peers in jsdom — see the BottomSheet suite. Passthrough mock.
vi.mock('@ux/disrupt', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

// AsyncIcon (the sheet's dismiss glyph) dynamically imports and does not render
// under jsdom.
vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon }: { icon: string }) => <svg data-testid={`icon-${icon}`} />,
}));

function trigger(tp: ResponsivePopoverTriggerArgs): ReactNode {
  return (
    <button
      type="button"
      data-testid="trigger"
      aria-haspopup={tp['aria-haspopup']}
      aria-expanded={tp['aria-expanded']}
      onClick={tp.onClick}
    >
      Open
    </button>
  );
}

function querySheet(): HTMLElement | null {
  return document.body.querySelector('.airo-surfaces-bottom-sheet__sheet');
}
function queryScrim(): HTMLElement | null {
  return document.body.querySelector('.airo-surfaces-bottom-sheet__scrim');
}
function queryFlyout(): HTMLElement | null {
  return document.body.querySelector('.airo-surfaces-responsive-popover__flyout');
}

describe('ResponsivePopover', () => {
  describe('trigger', () => {
    it('renders the trigger with dialog haspopup and collapsed state when closed', () => {
      render(
        <ResponsivePopover isMobile={false} sheetTitle="Publish" renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      const button = screen.getByTestId('trigger');
      expect(button).toHaveAttribute('aria-haspopup', 'dialog');
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('reflects the open state on the trigger', () => {
      render(
        <ResponsivePopover isMobile={false} open sheetTitle="Publish" renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      expect(screen.getByTestId('trigger')).toHaveAttribute('aria-expanded', 'true');
    });

    it('toggles onOpenChange with the next desired state on click', () => {
      const onOpenChange = vi.fn();
      const { rerender } = render(
        <ResponsivePopover
          isMobile={false}
          open={false}
          onOpenChange={onOpenChange}
          sheetTitle="Publish"
          renderTrigger={trigger}
        >
          body
        </ResponsivePopover>,
      );
      fireEvent.click(screen.getByTestId('trigger'));
      expect(onOpenChange).toHaveBeenLastCalledWith(true);

      rerender(
        <ResponsivePopover
          isMobile={false}
          open
          onOpenChange={onOpenChange}
          sheetTitle="Publish"
          renderTrigger={trigger}
        >
          body
        </ResponsivePopover>,
      );
      fireEvent.click(screen.getByTestId('trigger'));
      expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });
  });

  describe('desktop (isMobile=false)', () => {
    it('does not render the flyout when closed', () => {
      render(
        <ResponsivePopover isMobile={false} sheetTitle="Publish" renderTrigger={trigger}>
          <span data-testid="popover-body">hello</span>
        </ResponsivePopover>,
      );
      expect(queryFlyout()).toBeNull();
      expect(screen.queryByTestId('popover-body')).toBeNull();
    });

    it('opens an anchored dialog with the content on trigger click (uncontrolled)', () => {
      render(
        <ResponsivePopover isMobile={false} sheetTitle="Publish" renderTrigger={trigger}>
          <span data-testid="popover-body">hello</span>
        </ResponsivePopover>,
      );
      fireEvent.click(screen.getByTestId('trigger'));
      expect(queryFlyout()).not.toBeNull();
      expect(screen.getByTestId('popover-body')).toHaveTextContent('hello');
      expect(queryFlyout()).toHaveAttribute('role', 'dialog');
    });

    it('wires the dialog accessible name from a string sheetTitle', () => {
      render(
        <ResponsivePopover isMobile={false} open sheetTitle="Publish" renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      expect(queryFlyout()).toHaveAttribute('aria-label', 'Publish');
    });

    it('prefers an explicit aria-labelledby over a string sheetTitle (no aria-label)', () => {
      render(
        <ResponsivePopover
          isMobile={false}
          open
          sheetTitle="Publish"
          aria-labelledby="external-heading"
          renderTrigger={trigger}
        >
          body
        </ResponsivePopover>,
      );
      const flyout = queryFlyout();
      expect(flyout).toHaveAttribute('aria-labelledby', 'external-heading');
      expect(flyout).not.toHaveAttribute('aria-label');
    });

    it('does not render the flyout when controlled open is false', () => {
      const { rerender } = render(
        <ResponsivePopover isMobile={false} open={false} sheetTitle="Publish" renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      expect(queryFlyout()).toBeNull();
      rerender(
        <ResponsivePopover isMobile={false} open sheetTitle="Publish" renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      expect(queryFlyout()).not.toBeNull();
    });
  });

  describe('mobile (isMobile=true)', () => {
    it('does not render a sheet when closed', () => {
      render(
        <ResponsivePopover isMobile sheetTitle="Publish" renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      expect(querySheet()).toBeNull();
    });

    it('opens a bottom sheet with the content on trigger click (uncontrolled)', () => {
      render(
        <ResponsivePopover isMobile sheetTitle="Publish" renderTrigger={trigger}>
          <span data-testid="sheet-body">hello</span>
        </ResponsivePopover>,
      );
      expect(querySheet()).toBeNull();
      fireEvent.click(screen.getByTestId('trigger'));
      expect(querySheet()).not.toBeNull();
      expect(screen.getByTestId('sheet-body')).toHaveTextContent('hello');
    });

    it('renders the sheet as role=dialog and wires the string title to aria-labelledby', () => {
      render(
        <ResponsivePopover isMobile open sheetTitle="Publish" renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      const sheet = querySheet();
      expect(sheet).toHaveAttribute('role', 'dialog');
      const labelledBy = sheet?.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy as string)).toHaveTextContent('Publish');
    });

    it('forwards showSheetCloseButton=false to hide the sheet dismiss (X)', () => {
      const { rerender } = render(
        <ResponsivePopover isMobile open sheetTitle="Publish" renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

      rerender(
        <ResponsivePopover isMobile open sheetTitle="Publish" showSheetCloseButton={false} renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    });

    it('self-closes on scrim tap when uncontrolled', () => {
      render(
        <ResponsivePopover isMobile defaultOpen sheetTitle="Publish" renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      expect(querySheet()).not.toBeNull();
      fireEvent.click(queryScrim() as HTMLElement);
      expect(querySheet()).toBeNull();
    });

    it('does not self-close when controlled — fires onOpenChange(false) and stays mounted', () => {
      const onOpenChange = vi.fn();
      render(
        <ResponsivePopover isMobile open onOpenChange={onOpenChange} sheetTitle="Publish" renderTrigger={trigger}>
          body
        </ResponsivePopover>,
      );
      fireEvent.click(queryScrim() as HTMLElement);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(querySheet()).not.toBeNull();
    });
  });

  describe('uncontrolled defaultOpen', () => {
    it('renders open on mount (desktop)', () => {
      render(
        <ResponsivePopover isMobile={false} defaultOpen sheetTitle="Publish" renderTrigger={trigger}>
          <span data-testid="popover-body">hello</span>
        </ResponsivePopover>,
      );
      expect(queryFlyout()).not.toBeNull();
      expect(screen.getByTestId('popover-body')).toBeInTheDocument();
    });
  });
});
