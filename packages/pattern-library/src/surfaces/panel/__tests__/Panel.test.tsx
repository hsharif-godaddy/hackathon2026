import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Panel } from '../index';

vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon }: { icon: string }) => (
    <svg data-testid={`async-icon-${icon}`} data-icon={icon} />
  ),
}));

/**
 * `<Panel show />` mounts inside a Disrupt portal on `document.body`. We
 * query inside `document.body` directly rather than using the RTL container
 * because of that.
 */
function queryPanel(): HTMLElement | null {
  return document.body.querySelector('.airo-surfaces-panel__panel');
}

describe('Panel', () => {
  describe('controlled vs uncontrolled', () => {
    it('does not render when uncontrolled and defaultShow is false', () => {
      render(<Panel title="Settings" />);
      expect(queryPanel()).toBeNull();
    });

    it('renders when defaultShow is true', () => {
      render(<Panel defaultShow title="Settings" />);
      expect(queryPanel()).not.toBeNull();
    });

    it('honors the controlled `show` prop', () => {
      const { rerender } = render(<Panel show={false} title="Settings" />);
      expect(queryPanel()).toBeNull();

      rerender(<Panel show title="Settings" />);
      expect(queryPanel()).not.toBeNull();
    });

    it('does not self-close when controlled — consumer must update `show`', async () => {
      const onClose = vi.fn();
      render(<Panel show title="Settings" onClose={onClose} />);

      const closeButton = screen.getByRole('button', { name: /close/i });
      await userEvent.click(closeButton);

      expect(onClose).toHaveBeenCalled();
      // Component stays mounted because the consumer has not updated `show`.
      expect(queryPanel()).not.toBeNull();
    });

    it('self-closes when uncontrolled', async () => {
      render(<Panel defaultShow title="Settings" />);
      expect(queryPanel()).not.toBeNull();

      await userEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(queryPanel()).toBeNull();
    });
  });

  describe('default rendering', () => {
    it('renders role=dialog + aria-modal when showDisrupt is true (default)', () => {
      render(<Panel defaultShow title="Settings" />);
      const panel = queryPanel();
      expect(panel).toHaveAttribute('role', 'dialog');
      expect(panel).toHaveAttribute('aria-modal', 'true');
    });

    it('renders role=complementary when showDisrupt is false', () => {
      render(<Panel defaultShow title="Settings" showDisrupt={false} />);
      const panel = queryPanel();
      expect(panel).toHaveAttribute('role', 'complementary');
      expect(panel).not.toHaveAttribute('aria-modal');
    });

    it('wires aria-labelledby from string title', () => {
      render(<Panel defaultShow title="Settings" />);
      const panel = queryPanel();
      const labelledBy = panel?.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const labelNode = labelledBy ? document.getElementById(labelledBy) : null;
      expect(labelNode).toHaveTextContent('Settings');
    });

    it('renders the default close button with `closeLabel`', () => {
      render(<Panel defaultShow title="Settings" closeLabel="Dismiss" />);
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    it('forwards className and data-* to the panel root', () => {
      render(<Panel defaultShow title="X" className="custom" data-testid="panel-root" />);
      const panel = queryPanel();
      expect(panel).toHaveClass('custom');
      expect(panel).toHaveAttribute('data-testid', 'panel-root');
    });
  });

  describe('onClose', () => {
    it('fires when the default close button is clicked', async () => {
      const onClose = vi.fn();
      render(<Panel defaultShow title="Settings" onClose={onClose} />);
      await userEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('fires when the scrim is clicked (modal path)', async () => {
      const onClose = vi.fn();
      render(<Panel defaultShow title="Settings" onClose={onClose} />);
      const scrim = document.querySelector('.airo-surfaces-panel__scrim') as HTMLElement | null;
      expect(scrim).not.toBeNull();
      await userEvent.click(scrim as HTMLElement);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('fires on Escape in the non-modal path', async () => {
      const onClose = vi.fn();
      render(<Panel defaultShow title="Settings" showDisrupt={false} onClose={onClose} />);
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('header', () => {
    it('omits the header entirely when header is null', () => {
      render(<Panel defaultShow header={null} aria-label="Test panel" />);
      expect(document.querySelector('.airo-surfaces-panel-chrome__header')).toBeNull();
    });

    it('renders a custom header when provided', () => {
      render(
        <Panel
          defaultShow
          header={<div data-testid="custom-header">hi</div>}
          aria-label="Test panel"
        />,
      );
      expect(screen.getByTestId('custom-header')).toBeInTheDocument();
    });

    it('renders custom corner actions inside the default header', () => {
      render(
        <Panel
          defaultShow
          title="With custom actions"
          cornerActions={
            <button type="button" data-testid="custom-action">
              X
            </button>
          }
        />,
      );
      expect(screen.getByTestId('custom-action')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    });
  });

  describe('footer', () => {
    it('does not render the footer region when footer is nullish', () => {
      render(<Panel defaultShow title="X" />);
      expect(document.querySelector('.airo-surfaces-panel-chrome__footer')).toBeNull();
    });

    it('renders the footer region when footer is provided', () => {
      render(<Panel defaultShow title="X" footer={<div data-testid="footer">bar</div>} />);
      expect(screen.getByTestId('footer')).toBeInTheDocument();
    });

    it('marks the footer hidden when `hideFooter` is true', () => {
      render(
        <Panel defaultShow title="X" hideFooter footer={<div data-testid="footer">bar</div>} />,
      );
      const footer = document.querySelector('.airo-surfaces-panel-chrome__footer');
      expect(footer).toHaveAttribute('data-hidden', 'true');
    });

    it('slides the footer in and out when `hideFooter` toggles', () => {
      function Wrap({ hide }: { hide: boolean }) {
        return (
          <Panel
            defaultShow
            title="X"
            hideFooter={hide}
            footer={<div data-testid="footer">bar</div>}
          />
        );
      }
      const { rerender } = render(<Wrap hide={false} />);

      const initialFooter = document.querySelector('.airo-surfaces-panel-chrome__footer');
      expect(initialFooter).toHaveAttribute('data-hidden', 'false');

      rerender(<Wrap hide={true} />);

      const hiddenFooter = document.querySelector('.airo-surfaces-panel-chrome__footer');
      expect(hiddenFooter).toHaveAttribute('data-hidden', 'true');
    });

    it('forwards footerChrome="floating" to PanelChrome — applies floating class and renders content', () => {
      render(
        <Panel
          defaultShow
          title="X"
          footerChrome="floating"
          footer={<div data-testid="floating-footer-content">composer</div>}
        />,
      );
      const footer = document.querySelector('.airo-surfaces-panel-chrome__footer');
      expect(footer).toHaveClass('airo-surfaces-panel-chrome__footer--floating');
      expect(screen.getByTestId('floating-footer-content')).toBeInTheDocument();
    });
  });

  describe('stickyHeader', () => {
    it('applies the sticky class by default', () => {
      render(<Panel defaultShow title="X" />);
      expect(document.querySelector('.airo-surfaces-panel-chrome__header--sticky')).not.toBeNull();
    });

    it('drops the sticky class when stickyHeader is false', () => {
      render(<Panel defaultShow title="X" stickyHeader={false} />);
      expect(document.querySelector('.airo-surfaces-panel-chrome__header--sticky')).toBeNull();
    });

    it('does not toggle header visibility when stickyHeader is false', () => {
      render(<Panel defaultShow title="X" stickyHeader={false} />);
      const content = document.querySelector(
        '.airo-surfaces-panel-chrome__content',
      ) as HTMLElement | null;
      if (!content) throw new Error('content not found');

      // Simulate a big scroll-down. With stickyHeader=false the hide class
      // should never be applied.
      Object.defineProperty(content, 'scrollTop', { value: 200, configurable: true });
      fireEvent.scroll(content);
      expect(document.querySelector('.airo-surfaces-panel-chrome__header--hidden')).toBeNull();
    });
  });

  describe('RTL', () => {
    it('renders correctly inside a dir=rtl ancestor', () => {
      render(
        <div dir="rtl">
          <Panel defaultShow title="لوحة" />
        </div>,
      );
      // The panel portals to document.body; the RTL context is established
      // via [dir=rtl] selectors in CSS against the ancestor. Here we just
      // assert the panel mounts and its label renders, since JSDOM can't
      // resolve [dir] across the portal boundary.
      const panel = queryPanel();
      expect(panel).not.toBeNull();
      expect(panel).toHaveAttribute('role', 'dialog');
    });
  });
});
