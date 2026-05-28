import { fireEvent, render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PanelChrome } from '../PanelChrome';

vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon }: { icon: string }) => (
    <svg data-testid={`async-icon-${icon}`} data-icon={icon} />
  ),
}));

/**
 * `PanelChrome` is rendered inline (no portal) so we can query the rendered
 * output directly via the React Testing Library container. Surfaces are the
 * ones that introduce a portal/host — chrome itself is host-agnostic.
 */
describe('PanelChrome', () => {
  describe('landmark + accessible name', () => {
    it('renders role="dialog" + aria-modal="true" when modal is true', () => {
      render(
        <PanelChrome title="Settings" modal onClose={vi.fn()}>
          body
        </PanelChrome>,
      );
      const root = screen.getByRole('dialog');
      expect(root).toHaveAttribute('aria-modal', 'true');
    });

    it('renders role="complementary" + no aria-modal when modal is false', () => {
      render(
        <PanelChrome title="Inspector" onClose={vi.fn()}>
          body
        </PanelChrome>,
      );
      const root = screen.getByRole('complementary');
      expect(root).not.toHaveAttribute('aria-modal');
    });

    it('renders role="dialog" + aria-modal="false" when modal is "non-modal-dialog"', () => {
      render(
        <PanelChrome title="Floating" modal="non-modal-dialog" onClose={vi.fn()}>
          body
        </PanelChrome>,
      );
      const root = screen.getByRole('dialog');
      expect(root).toHaveAttribute('aria-modal', 'false');
    });

    it('wires aria-labelledby from a string title (default header path)', () => {
      render(
        <PanelChrome title="Settings" modal onClose={vi.fn()}>
          body
        </PanelChrome>,
      );
      const root = screen.getByRole('dialog');
      const labelledBy = root.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const labelNode = labelledBy ? document.getElementById(labelledBy) : null;
      expect(labelNode).toHaveTextContent('Settings');
    });

    it('falls back to aria-label when a custom header is provided', () => {
      render(
        <PanelChrome
          aria-label="Inspector"
          header={<div data-testid="custom-header">x</div>}
          onClose={vi.fn()}
        >
          body
        </PanelChrome>,
      );
      const root = screen.getByRole('complementary', { name: 'Inspector' });
      expect(root).toBeInTheDocument();
    });

    it('forwards className and data-* to the chrome root', () => {
      render(
        <PanelChrome
          aria-label="X"
          className="custom"
          data-testid="chrome-root"
          onClose={vi.fn()}
        />,
      );
      const root = screen.getByTestId('chrome-root');
      expect(root).toHaveClass('airo-surfaces-panel-chrome', 'custom');
    });
  });

  describe('header', () => {
    it('renders the default close button with `closeLabel`', () => {
      render(<PanelChrome title="X" closeLabel="Dismiss" onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });

    it('omits the header band when header is null', () => {
      render(<PanelChrome aria-label="X" header={null} onClose={vi.fn()} />);
      expect(document.querySelector('.airo-surfaces-panel-chrome__header')).toBeNull();
    });

    it('renders a custom header when provided', () => {
      render(
        <PanelChrome
          aria-label="X"
          header={<div data-testid="custom-header">hi</div>}
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByTestId('custom-header')).toBeInTheDocument();
    });

    it('renders custom corner actions inside the default header', () => {
      render(
        <PanelChrome
          title="X"
          cornerActions={
            <button type="button" data-testid="custom-action">
              X
            </button>
          }
          onClose={vi.fn()}
        />,
      );
      expect(screen.getByTestId('custom-action')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /close/i })).not.toBeInTheDocument();
    });
  });

  describe('expanded toggle (controlled + uncontrolled)', () => {
    it('renders Expand by default and Collapse once toggled', async () => {
      render(<PanelChrome title="X" onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
      expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
    });

    it('honors a controlled expanded prop', () => {
      render(<PanelChrome title="X" expanded onClose={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
    });

    it('fires onExpandedChange when toggled', async () => {
      const onExpandedChange = vi.fn();
      render(<PanelChrome title="X" onExpandedChange={onExpandedChange} onClose={vi.fn()} />);
      await userEvent.click(screen.getByRole('button', { name: 'Expand' }));
      expect(onExpandedChange).toHaveBeenCalledWith(true);
    });
  });

  describe('footer', () => {
    it('does not render the footer region when footer is nullish', () => {
      render(<PanelChrome title="X" onClose={vi.fn()} />);
      expect(document.querySelector('.airo-surfaces-panel-chrome__footer')).toBeNull();
    });

    it('renders the footer region when footer is provided', () => {
      render(
        <PanelChrome title="X" footer={<div data-testid="footer">bar</div>} onClose={vi.fn()} />,
      );
      expect(screen.getByTestId('footer')).toBeInTheDocument();
    });

    it('marks the footer hidden when `hideFooter` is true', () => {
      render(
        <PanelChrome
          title="X"
          hideFooter
          footer={<div data-testid="footer">bar</div>}
          onClose={vi.fn()}
        />,
      );
      const footer = document.querySelector('.airo-surfaces-panel-chrome__footer');
      expect(footer).toHaveAttribute('data-hidden', 'true');
    });

    it('sets inert on the footer wrapper when hideFooter is true', () => {
      render(
        <PanelChrome
          title="X"
          hideFooter
          footer={<div data-testid="footer-content">bar</div>}
          onClose={vi.fn()}
        />,
      );
      const footer = document.querySelector('.airo-surfaces-panel-chrome__footer');
      expect(footer).toHaveAttribute('inert');
    });

    it('removes inert from the footer wrapper when hideFooter is false', () => {
      render(
        <PanelChrome
          title="X"
          footer={<div data-testid="footer-content">bar</div>}
          onClose={vi.fn()}
        />,
      );
      const footer = document.querySelector('.airo-surfaces-panel-chrome__footer');
      expect(footer).not.toHaveAttribute('inert');
    });

    it('uses floating footer chrome when footerChrome is floating', () => {
      render(
        <PanelChrome
          title="X"
          footerChrome="floating"
          footer={<div data-testid="footer-floating">bar</div>}
          onClose={vi.fn()}
        />,
      );
      const footer = document.querySelector('.airo-surfaces-panel-chrome__footer');
      expect(footer).toHaveClass('airo-surfaces-panel-chrome__footer--floating');
      expect(
        document.querySelector('.airo-surfaces-panel-chrome__footer-body-skin--floating'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('footer-floating')).toBeInTheDocument();
    });

    it('uses default padded Box wrapper when footerChrome is default', () => {
      render(
        <PanelChrome
          title="X"
          footer={<div data-testid="footer-default">bar</div>}
          onClose={vi.fn()}
        />,
      );
      const footer = document.querySelector('.airo-surfaces-panel-chrome__footer');
      expect(footer).not.toHaveClass('airo-surfaces-panel-chrome__footer--floating');
      expect(
        document.querySelector('.airo-surfaces-panel-chrome__footer-body-skin--floating'),
      ).not.toBeInTheDocument();
      const footerBody = document.querySelector('.airo-surfaces-panel-chrome__footer-body');
      expect(footerBody).toContainElement(screen.getByTestId('footer-default'));
    });
  });

  describe('stickyHeader', () => {
    it('applies the sticky class by default', () => {
      render(<PanelChrome title="X" onClose={vi.fn()} />);
      expect(document.querySelector('.airo-surfaces-panel-chrome__header--sticky')).not.toBeNull();
    });

    it('drops the sticky class when stickyHeader is false', () => {
      render(<PanelChrome title="X" stickyHeader={false} onClose={vi.fn()} />);
      expect(document.querySelector('.airo-surfaces-panel-chrome__header--sticky')).toBeNull();
    });

    it('does not toggle header visibility when stickyHeader is false', () => {
      render(<PanelChrome title="X" stickyHeader={false} onClose={vi.fn()} />);
      const content = document.querySelector(
        '.airo-surfaces-panel-chrome__content',
      ) as HTMLElement | null;
      if (!content) throw new Error('content not found');

      Object.defineProperty(content, 'scrollTop', { value: 200, configurable: true });
      fireEvent.scroll(content);
      expect(document.querySelector('.airo-surfaces-panel-chrome__header--hidden')).toBeNull();
    });
  });

  describe('headerChrome', () => {
    it('omits the ghost modifier on the header by default', () => {
      render(<PanelChrome title="X" onClose={vi.fn()} />);
      expect(document.querySelector('.airo-surfaces-panel-chrome__header--ghost')).toBeNull();
    });

    it('applies the ghost modifier on the header when headerChrome is "ghost"', () => {
      render(<PanelChrome title="X" headerChrome="ghost" onClose={vi.fn()} />);
      expect(document.querySelector('.airo-surfaces-panel-chrome__header--ghost')).not.toBeNull();
    });
  });

  describe('escape + close', () => {
    it('fires onClose on Escape in non-modal mode', async () => {
      const onClose = vi.fn();
      render(
        <PanelChrome title="X" onClose={onClose}>
          body
        </PanelChrome>,
      );
      // Focus has moved to the chrome root via the mount effect; press Escape.
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalled();
    });

    it('does not fire onClose on Escape in modal mode (the surface owns it)', async () => {
      const onClose = vi.fn();
      render(
        <PanelChrome title="X" modal onClose={onClose}>
          body
        </PanelChrome>,
      );
      await userEvent.keyboard('{Escape}');
      expect(onClose).not.toHaveBeenCalled();
    });

    it('fires onClose on Escape in non-modal-dialog mode', async () => {
      const onClose = vi.fn();
      render(
        <PanelChrome title="X" modal="non-modal-dialog" onClose={onClose}>
          body
        </PanelChrome>,
      );
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalled();
    });

    it('fires onClose on the default close button click', async () => {
      const onClose = vi.fn();
      render(<PanelChrome title="X" onClose={onClose} />);
      await userEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('drag handle a11y', () => {
    it('is absent when dragHandle is false (default)', () => {
      render(<PanelChrome title="X" onClose={vi.fn()} />);
      expect(
        document.querySelector('.airo-surfaces-panel-chrome__drag-handle'),
      ).not.toBeInTheDocument();
    });

    it('is in the tab order and has the default accessible label', () => {
      render(<PanelChrome title="X" onClose={vi.fn()} dragHandle />);
      const handle = document.querySelector(
        '.airo-surfaces-panel-chrome__drag-handle',
      ) as HTMLElement;
      expect(handle).toBeInTheDocument();
      expect(handle).toHaveAttribute('tabindex', '0');
      expect(handle).toHaveAccessibleName('Move panel — use Arrow keys');
    });

    it('accepts a custom dragHandleLabel', () => {
      render(
        <PanelChrome title="X" onClose={vi.fn()} dragHandle dragHandleLabel="Drag to reposition" />,
      );
      const handle = document.querySelector(
        '.airo-surfaces-panel-chrome__drag-handle',
      ) as HTMLElement;
      expect(handle).toHaveAttribute('aria-label', 'Drag to reposition');
    });
  });
});

// ── Smart auto-scroll ──────────────────────────────────────────────────────
// autoScroll="smart-bottom" should scroll to the bottom on every DOM mutation
// when engaged, pause when the user scrolls up, and re-engage when they scroll
// back within threshold.

describe('PanelChrome — autoScroll="smart-bottom"', () => {
  function renderWithAutoScroll(threshold?: number) {
    const props = threshold !== undefined ? { autoScrollThreshold: threshold } : {};
    const { container } = render(
      <PanelChrome title="Test" onClose={vi.fn()} autoScroll="smart-bottom" {...props}>
        <div>initial</div>
      </PanelChrome>,
    );
    const content = container.querySelector('.airo-surfaces-panel-chrome__content') as HTMLElement;
    // jsdom doesn't run layout, so wire up the scroll properties manually.
    Object.defineProperty(content, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(content, 'clientHeight', { value: 600, configurable: true });
    // scrollTop is writable by default in jsdom.
    return { container, content };
  }

  it('scrolls to bottom on childList mutation when engaged', async () => {
    vi.useFakeTimers();
    try {
      const { content } = renderWithAutoScroll();

      await act(async () => {
        content.appendChild(document.createElement('div'));
        // Flush MutationObserver microtask, then the rAF callback.
        await Promise.resolve();
        vi.runAllTimers();
      });

      // Correct bottom position: scrollHeight - clientHeight (browsers clamp scrollTop
      // to this value; using it directly keeps the test honest in both jsdom and real
      // browsers).
      expect(content.scrollTop).toBe(content.scrollHeight - content.clientHeight);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disengages auto-scroll when user scrolls up', async () => {
    vi.useFakeTimers();
    try {
      const { content } = renderWithAutoScroll();

      // First scroll establishes lastScrollTop = 300.
      content.scrollTop = 300;
      fireEvent.scroll(content);
      // Scroll up: currentScrollTop < lastScrollTop → disengage.
      content.scrollTop = 100;
      fireEvent.scroll(content);

      // Now a mutation should NOT trigger a scroll to bottom.
      await act(async () => {
        content.appendChild(document.createElement('div'));
        await Promise.resolve();
        vi.runAllTimers();
      });

      // scrollTop should remain at 100, not jump to scrollHeight (1000).
      expect(content.scrollTop).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-engages auto-scroll when user scrolls back within threshold', async () => {
    vi.useFakeTimers();
    try {
      const { content } = renderWithAutoScroll(144);

      // Disengage by scrolling up.
      content.scrollTop = 300;
      fireEvent.scroll(content);
      content.scrollTop = 100;
      fireEvent.scroll(content);

      // Scroll to near-bottom: distFromBottom = 1000 - 400 - 600 = 0 ≤ 144 → re-engage.
      content.scrollTop = 400;
      fireEvent.scroll(content);

      // Now a mutation SHOULD trigger a scroll to bottom again.
      await act(async () => {
        content.appendChild(document.createElement('div'));
        await Promise.resolve();
        vi.runAllTimers();
      });

      expect(content.scrollTop).toBe(content.scrollHeight - content.clientHeight);
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrolls to bottom on characterData mutation (streaming text updates)', async () => {
    vi.useFakeTimers();
    try {
      const { content } = renderWithAutoScroll();

      // Add a text node first so we can mutate it in place (streaming pattern).
      const textNode = document.createTextNode('Hello');
      content.appendChild(textNode);

      await act(async () => {
        // Mutate the text node in place — this fires a characterData mutation.
        textNode.nodeValue = 'Hello world';
        await Promise.resolve();
        vi.runAllTimers();
      });

      expect(content.scrollTop).toBe(content.scrollHeight - content.clientHeight);
    } finally {
      vi.useRealTimers();
    }
  });
});
