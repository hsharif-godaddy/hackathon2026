import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FullscreenDialog, type FullscreenDialogProps } from '../FullscreenDialog';

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon }: { icon: string }) => (
    <svg data-testid={`async-icon-${icon}`} data-icon={icon} />
  ),
}));

// @ux/disrupt is mocked via the vitest module alias configured in
// vitest.config.ts (same setup as the Panel tests). The mock renders
// children inside a plain wrapper so Testing Library can query the dialog.

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Merge partial overrides onto sensible defaults. */
function renderDialog(overrides: Partial<FullscreenDialogProps> = {}) {
  const props = {
    title: 'Test dialog',
    show: true,
    onClose: vi.fn(),
    ...overrides,
  } as FullscreenDialogProps;
  return render(<FullscreenDialog {...props} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('FullscreenDialog', () => {
  describe('show / hide', () => {
    it('renders nothing when show is false', () => {
      renderDialog({ show: false });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders when show is true', () => {
      renderDialog({ show: true });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders when defaultShow is true (uncontrolled)', () => {
      render(<FullscreenDialog title="X" defaultShow onClose={vi.fn()} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('does not render when defaultShow is false (default)', () => {
      render(<FullscreenDialog title="X" onClose={vi.fn()} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('landmark + accessible name', () => {
    it('renders role="dialog"', () => {
      renderDialog();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders aria-modal="true" (modal dialog)', () => {
      renderDialog();
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('wires aria-labelledby from a string title', () => {
      renderDialog({ title: 'My dialog' });
      const dialog = screen.getByRole('dialog');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      if (!labelledBy) throw new Error('aria-labelledby not set');
      expect(document.getElementById(labelledBy)).toHaveTextContent('My dialog');
    });

    it('accepts aria-label as an accessible name', () => {
      render(<FullscreenDialog aria-label="Fullscreen assistant" show onClose={vi.fn()} />);
      expect(screen.getByRole('dialog', { name: 'Fullscreen assistant' })).toBeInTheDocument();
    });

    it('forwards className to the chrome root', () => {
      renderDialog({ className: 'custom-class' });
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveClass('airo-surfaces-fullscreen-dialog__chrome', 'custom-class');
    });
  });

  describe('close', () => {
    it('fires onClose when the default close button is clicked', async () => {
      const onClose = vi.fn();
      renderDialog({ onClose });
      await userEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('hides itself (uncontrolled) after close button click', async () => {
      function Wrapper() {
        const [show, setShow] = useState(true);
        return <FullscreenDialog title="X" show={show} onClose={() => setShow(false)} />;
      }
      render(<Wrapper />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('PanelChrome passthrough', () => {
    it('renders body children', () => {
      renderDialog({ children: <div data-testid="body">hello</div> });
      expect(screen.getByTestId('body')).toBeInTheDocument();
    });

    it('renders footer when provided', () => {
      renderDialog({ footer: <div data-testid="footer">footer</div> });
      expect(screen.getByTestId('footer')).toBeInTheDocument();
    });

    it('renders a custom header when provided', () => {
      renderDialog({ header: <div data-testid="custom-header">header</div> });
      expect(screen.getByTestId('custom-header')).toBeInTheDocument();
    });

    it('forwards footerChrome="floating" to PanelChrome', () => {
      renderDialog({
        footer: <div data-testid="floating-footer-slot">composer</div>,
        footerChrome: 'floating',
      });
      expect(
        document.querySelector('.airo-surfaces-panel-chrome__footer--floating'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('floating-footer-slot')).toBeInTheDocument();
    });

    it('renders the default close button with a custom closeLabel', () => {
      renderDialog({ closeLabel: 'Dismiss' });
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });
  });
});
