import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FloatingPanel, type FloatingPanelProps, getSnapTarget } from '../FloatingPanel';

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock('@ux/icon/async-icon.js', () => ({
  default: ({ icon }: { icon: string }) => (
    <svg data-testid={`async-icon-${icon}`} data-icon={icon} />
  ),
}));

// react-rnd renders a drag + resize wrapper in a real browser; in JSDOM we
// substitute it with a transparent div that still renders children so we can
// test FloatingPanel's behavioural layer (show/hide, close, keyboard, props).
// The mock also exposes trigger helpers so tests can invoke drag/resize
// callbacks and keep function-coverage above the global threshold.
type RndProps = {
  children?: React.ReactNode;
  className?: string;
  onDrag?: (e: unknown, data: { x: number; y: number }) => void;
  onDragStop?: (e: unknown, data: { x: number; y: number }) => void;
  onResizeStop?: (
    e: unknown,
    dir: unknown,
    ref: HTMLElement,
    delta: unknown,
    pos: { x: number; y: number },
  ) => void;
  [key: string]: unknown;
};

let rndCallbacks: RndProps = {};

vi.mock('react-rnd', () => ({
  Rnd: ({ children, className, onDrag, onDragStop, onResizeStop, ...rest }: RndProps) => {
    rndCallbacks = { onDrag, onDragStop, onResizeStop, ...rest };
    return (
      <div data-testid="rnd-root" className={className}>
        {children}
      </div>
    );
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Merge partial overrides onto sensible defaults so individual tests stay concise. */
function renderFloatingPanel(overrides: Partial<FloatingPanelProps> = {}) {
  const props = {
    title: 'Test panel',
    show: true,
    onClose: vi.fn(),
    ...overrides,
  } as FloatingPanelProps;
  return render(<FloatingPanel {...props} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('FloatingPanel', () => {
  describe('show / hide', () => {
    it('renders nothing when show is false', () => {
      renderFloatingPanel({ show: false });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders when show is true', () => {
      renderFloatingPanel({ show: true });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders when defaultShow is true (uncontrolled)', () => {
      render(<FloatingPanel title="X" defaultShow onClose={vi.fn()} />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('does not render when defaultShow is not set', () => {
      render(<FloatingPanel title="X" onClose={vi.fn()} />);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('landmark + accessible name', () => {
    it('renders role="dialog"', () => {
      renderFloatingPanel();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders aria-modal="false" (non-modal panel)', () => {
      renderFloatingPanel();
      expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal', 'true');
    });

    it('wires aria-labelledby from a string title', () => {
      renderFloatingPanel({ title: 'My panel' });
      const dialog = screen.getByRole('dialog');
      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      if (!labelledBy) throw new Error('aria-labelledby not set');
      expect(document.getElementById(labelledBy)).toHaveTextContent('My panel');
    });

    it('accepts aria-label as an accessible name', () => {
      render(<FloatingPanel aria-label="Floating assistant" show onClose={vi.fn()} />);
      expect(screen.getByRole('dialog', { name: 'Floating assistant' })).toBeInTheDocument();
    });

    it('forwards className to the chrome root', () => {
      renderFloatingPanel({ className: 'custom-class' });
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveClass('airo-surfaces-floating-panel__chrome', 'custom-class');
    });
  });

  describe('close', () => {
    it('fires onClose when the default close button is clicked', async () => {
      const onClose = vi.fn();
      renderFloatingPanel({ onClose });
      await userEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('fires onClose on Escape (non-modal path — PanelChrome handles it)', async () => {
      const onClose = vi.fn();
      renderFloatingPanel({ onClose });
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('hides itself (uncontrolled) after close button click', async () => {
      function Wrapper() {
        const [show, setShow] = useState(true);
        return <FloatingPanel title="X" show={show} onClose={() => setShow(false)} />;
      }
      render(<Wrapper />);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /close/i }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  describe('PanelChrome passthrough', () => {
    it('renders body children inside the panel', () => {
      renderFloatingPanel({
        children: <div data-testid="body-content">hello</div>,
      });
      expect(screen.getByTestId('body-content')).toBeInTheDocument();
    });

    it('renders footer when provided', () => {
      renderFloatingPanel({
        footer: <div data-testid="footer">footer</div>,
      });
      expect(screen.getByTestId('footer')).toBeInTheDocument();
    });

    it('forwards footerChrome="floating" to PanelChrome', () => {
      renderFloatingPanel({
        footer: <div data-testid="floating-footer-slot">composer</div>,
        footerChrome: 'floating',
      });
      expect(
        document.querySelector('.airo-surfaces-panel-chrome__footer--floating'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('floating-footer-slot')).toBeInTheDocument();
    });

    it('renders a custom header when provided', () => {
      renderFloatingPanel({
        header: <div data-testid="custom-header">custom</div>,
      });
      expect(screen.getByTestId('custom-header')).toBeInTheDocument();
    });

    it('renders the default close button with a custom closeLabel', () => {
      renderFloatingPanel({ closeLabel: 'Dismiss' });
      expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    });
  });

  // ── Snap-to-dock ────────────────────────────────────────────────────────

  describe('snap-to-dock — docked to viewport edge', () => {
    it('renders --docked-right class when defaultDockedTo is "right"', () => {
      renderFloatingPanel({ defaultDockedTo: 'right' });
      const panel = document.querySelector('.airo-surfaces-floating-panel');
      expect(panel).toHaveClass('airo-surfaces-floating-panel--docked-right');
    });

    it('renders --docked-left class when defaultDockedTo is "left"', () => {
      renderFloatingPanel({ defaultDockedTo: 'left' });
      const panel = document.querySelector('.airo-surfaces-floating-panel');
      expect(panel).toHaveClass('airo-surfaces-floating-panel--docked-left');
    });

    it('renders --docked-right when controlled dockedTo is "right"', () => {
      renderFloatingPanel({ dockedTo: 'right' });
      const panel = document.querySelector('.airo-surfaces-floating-panel');
      expect(panel).toHaveClass('airo-surfaces-floating-panel--docked-right');
    });

    it('shows expand and close buttons in docked mode (no separate undock button)', () => {
      renderFloatingPanel({ defaultDockedTo: 'right' });
      expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /undock/i })).not.toBeInTheDocument();
    });

    it('drag handle pill is present in the header when docked', () => {
      renderFloatingPanel({ defaultDockedTo: 'right' });
      const handle = document.querySelector('.airo-surfaces-panel-chrome__drag-handle');
      expect(handle).toBeInTheDocument();
    });

    it('drag handle triggers onPointerDown without throwing', () => {
      // Verifies the handler is wired and doesn't throw on interaction.
      // Full drag-to-undock flow (pointer threshold + coordinate tracking) is
      // not reliably testable in jsdom; use browser/e2e tests for that path.
      renderFloatingPanel({ defaultDockedTo: 'right' });
      const handle = document.querySelector(
        '.airo-surfaces-panel-chrome__drag-handle',
      ) as HTMLElement;
      expect(() =>
        fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, pointerId: 1 }),
      ).not.toThrow();
    });

    it('does not fire onDock on initial render when floating (controlled)', () => {
      const onDock = vi.fn();
      renderFloatingPanel({ dockedTo: null, onDock });
      expect(onDock).not.toHaveBeenCalled();
    });

    it('does not show the rnd root when docked', () => {
      renderFloatingPanel({ defaultDockedTo: 'right' });
      expect(screen.queryByTestId('rnd-root')).not.toBeInTheDocument();
    });

    it('shows the rnd root when floating', () => {
      renderFloatingPanel();
      expect(screen.getByTestId('rnd-root')).toBeInTheDocument();
    });
  });

  describe('lockedDocked', () => {
    it('hides the drag-handle pill when lockedDocked is true and panel is docked', () => {
      renderFloatingPanel({ defaultDockedTo: 'right', lockedDocked: true });
      expect(
        document.querySelector('.airo-surfaces-panel-chrome__drag-handle'),
      ).not.toBeInTheDocument();
    });

    it('keeps the drag-handle pill when lockedDocked is false (default)', () => {
      renderFloatingPanel({ defaultDockedTo: 'right' });
      expect(
        document.querySelector('.airo-surfaces-panel-chrome__drag-handle'),
      ).toBeInTheDocument();
    });

    it('lockedDocked has no effect while floating — handle still renders', () => {
      // The prop only modifies docked-mode behavior; floating mode keeps its
      // drag-handle pill so the panel stays movable.
      renderFloatingPanel({ lockedDocked: true });
      expect(
        document.querySelector('.airo-surfaces-panel-chrome__drag-handle'),
      ).toBeInTheDocument();
    });
  });

  describe('snap-to-dock — docked into a DropZone element', () => {
    it('portals into the provided HTMLElement when dockedTo is an element', () => {
      const zoneEl = document.createElement('div');
      document.body.appendChild(zoneEl);

      renderFloatingPanel({ dockedTo: zoneEl });

      // Dialog should be inside the zone element
      const dialog = zoneEl.querySelector('[role="dialog"]');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveClass('airo-surfaces-floating-panel__chrome');

      // The panel wrapper should carry the docked-zone class
      const panel = zoneEl.querySelector('.airo-surfaces-floating-panel');
      expect(panel).toHaveClass('airo-surfaces-floating-panel--docked-zone');

      document.body.removeChild(zoneEl);
    });

    it('adds --docked class to the zone element when panel is docked there', () => {
      const zoneEl = document.createElement('div');
      document.body.appendChild(zoneEl);

      renderFloatingPanel({ dockedTo: zoneEl });

      expect(zoneEl).toHaveClass('airo-surfaces-floating-panel__drop-zone--docked');

      document.body.removeChild(zoneEl);
    });

    it('removes --docked class from the zone element when panel undocks via expand+collapse', async () => {
      const zoneEl = document.createElement('div');
      document.body.appendChild(zoneEl);

      renderFloatingPanel({ defaultDockedTo: zoneEl });
      expect(zoneEl).toHaveClass('airo-surfaces-floating-panel__drop-zone--docked');

      // Expand to full-screen then collapse — collapses back to zone-docked.
      // The --docked class should remain since the panel is still docked there.
      await userEvent.click(screen.getByRole('button', { name: /expand/i }));
      await userEvent.click(screen.getByRole('button', { name: /collapse/i }));

      // Panel is back in the zone — class still present
      expect(zoneEl).toHaveClass('airo-surfaces-floating-panel__drop-zone--docked');

      document.body.removeChild(zoneEl);
    });

    it('renders a DropZone with the correct base class', () => {
      function Wrapper() {
        const ref = useRef<HTMLDivElement>(null);
        return <FloatingPanel.DropZone ref={ref} data-testid="zone" />;
      }
      render(<Wrapper />);
      expect(screen.getByTestId('zone')).toHaveClass('airo-surfaces-floating-panel__drop-zone');
    });

    it('borderSides: renders a single logical side modifier class', () => {
      render(<FloatingPanel.DropZone data-testid="zone" borderSides="inline-end" />);
      const zone = screen.getByTestId('zone');
      expect(zone).toHaveClass('airo-surfaces-floating-panel__drop-zone--border-inline-end');
      expect(zone).not.toHaveClass('airo-surfaces-floating-panel__drop-zone--border-inline-start');
    });

    it('borderSides: accepts an array and renders one modifier per side', () => {
      render(
        <FloatingPanel.DropZone data-testid="zone" borderSides={['block-start', 'inline-end']} />,
      );
      const zone = screen.getByTestId('zone');
      expect(zone).toHaveClass('airo-surfaces-floating-panel__drop-zone--border-block-start');
      expect(zone).toHaveClass('airo-surfaces-floating-panel__drop-zone--border-inline-end');
    });

    it('borderSides: omitting the prop adds no border modifier classes', () => {
      render(<FloatingPanel.DropZone data-testid="zone" />);
      const zone = screen.getByTestId('zone');
      const cls = zone.className;
      expect(cls).not.toMatch(/--border-/);
    });

    it('borderSides: composes with consumer className and activeClassName forwarding', () => {
      render(
        <FloatingPanel.DropZone
          data-testid="zone"
          className="my-zone"
          activeClassName="my-zone--active"
          borderSides="inline-start"
        />,
      );
      const zone = screen.getByTestId('zone');
      expect(zone).toHaveClass('airo-surfaces-floating-panel__drop-zone');
      expect(zone).toHaveClass('airo-surfaces-floating-panel__drop-zone--border-inline-start');
      expect(zone).toHaveClass('my-zone');
      expect(zone.dataset.activeClassName).toBe('my-zone--active');
    });
  });
});

// ── getSnapTarget unit tests (pure function, no React) ────────────────────

describe('getSnapTarget', () => {
  const viewport = 1200;
  const threshold = 80;
  const noZones: React.RefObject<HTMLElement | null>[] = [];

  it('returns null when panel is in the middle of the viewport', () => {
    expect(
      getSnapTarget({ x: 400, y: 100, width: 384, height: 560 }, viewport, threshold, noZones),
    ).toBeNull();
  });

  it('returns "right" when panel right edge is within threshold of viewport right', () => {
    // Panel right edge = 400 + 900 = 1300 > 1200 - 80 = 1120
    expect(
      getSnapTarget({ x: 900, y: 100, width: 400, height: 560 }, viewport, threshold, noZones),
    ).toBe('right');
  });

  it('returns "left" when panel left edge is within threshold', () => {
    expect(
      getSnapTarget({ x: 40, y: 100, width: 384, height: 560 }, viewport, threshold, noZones),
    ).toBe('left');
  });

  it('prefers drop zone over right edge', () => {
    const zoneEl = document.createElement('div');
    // Mock getBoundingClientRect to simulate zone at x:800-1200
    zoneEl.getBoundingClientRect = () =>
      ({ left: 800, right: 1200, top: 0, bottom: 800 }) as DOMRect;

    const zoneRef = { current: zoneEl };
    // Panel at x=860, width=400 — overlaps zone AND is near right edge
    const result = getSnapTarget({ x: 860, y: 100, width: 400, height: 560 }, viewport, threshold, [
      zoneRef,
    ]);
    expect(result).toBe(zoneEl);
  });

  it('returns null when zone ref has no element', () => {
    const zoneRef = { current: null };
    expect(
      getSnapTarget({ x: 40, y: 100, width: 384, height: 560 }, viewport, threshold, [zoneRef]),
    ).toBe('left');
  });

  it('honors disableEdgeSnap=true: skips left / right viewport-edge snapping', () => {
    // Panel near right edge — without the flag this would snap to "right".
    expect(
      getSnapTarget(
        { x: 900, y: 100, width: 400, height: 560 },
        viewport,
        threshold,
        noZones,
        true,
      ),
    ).toBeNull();

    // Panel near left edge — also skipped with the flag set.
    expect(
      getSnapTarget({ x: 40, y: 100, width: 384, height: 560 }, viewport, threshold, noZones, true),
    ).toBeNull();
  });

  it('disableEdgeSnap still allows drop-zone snapping', () => {
    const zoneEl = document.createElement('div');
    zoneEl.getBoundingClientRect = () =>
      ({ left: 800, right: 1200, top: 0, bottom: 800 }) as DOMRect;
    const zoneRef = { current: zoneEl };
    expect(
      getSnapTarget(
        { x: 860, y: 100, width: 400, height: 560 },
        viewport,
        threshold,
        [zoneRef],
        true,
      ),
    ).toBe(zoneEl);
  });

  it('threshold expansion: snaps to a zero-width drop zone when the panel is within `threshold`', () => {
    // Collapsed (zero-width) zone sitting at x=0
    const zoneEl = document.createElement('div');
    zoneEl.getBoundingClientRect = () =>
      ({ left: 0, right: 0, top: 0, bottom: 800, width: 0, height: 800 }) as DOMRect;
    const zoneRef = { current: zoneEl };
    // Panel left edge = 50, which is within `threshold` (80) of the zone's edge at 0.
    // Without the threshold expansion this overlap check would never fire on a 0-width zone.
    expect(
      getSnapTarget({ x: 50, y: 100, width: 384, height: 560 }, viewport, threshold, [zoneRef]),
    ).toBe(zoneEl);
  });
});

// ── Keyboard move + resize ────────────────────────────────────────────────

describe('FloatingPanel — keyboard move / resize', () => {
  it('calls onPositionChange with updated x when ArrowRight fires on header non-interactive area', () => {
    const onPositionChange = vi.fn();
    renderFloatingPanel({ position: { x: 100, y: 100 }, onPositionChange });

    // Fire keydown with target set to the header element itself (non-interactive).
    const header = document.querySelector('.airo-surfaces-panel-chrome__header') as HTMLElement;
    fireEvent.keyDown(header, { key: 'ArrowRight', bubbles: true });

    expect(onPositionChange).toHaveBeenCalledWith({ x: 108, y: 100 });
  });

  it('calls onPositionChange with updated y when ArrowDown fires on header', () => {
    const onPositionChange = vi.fn();
    renderFloatingPanel({ position: { x: 0, y: 0 }, onPositionChange });

    const header = document.querySelector('.airo-surfaces-panel-chrome__header') as HTMLElement;
    fireEvent.keyDown(header, { key: 'ArrowDown', bubbles: true });

    expect(onPositionChange).toHaveBeenCalledWith({ x: 0, y: 8 });
  });

  it('does not intercept ArrowRight from a button inside the header', () => {
    const onPositionChange = vi.fn();
    renderFloatingPanel({ position: { x: 0, y: 0 }, onPositionChange });

    // The close button is inside the header — arrow keys should not move the panel.
    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.keyDown(closeBtn, { key: 'ArrowRight', bubbles: true });

    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('does not intercept arrow keys when defaultPrevented', () => {
    const onPositionChange = vi.fn();
    renderFloatingPanel({ position: { x: 0, y: 0 }, onPositionChange });

    const header = document.querySelector('.airo-surfaces-panel-chrome__header') as HTMLElement;
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
    Object.defineProperty(event, 'defaultPrevented', { value: true });
    header.dispatchEvent(event);

    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('calls onSizeChange with updated width when Shift+ArrowRight fires on header', () => {
    const onSizeChange = vi.fn();
    renderFloatingPanel({ size: { width: 400, height: 600 }, onSizeChange });

    const header = document.querySelector('.airo-surfaces-panel-chrome__header') as HTMLElement;
    fireEvent.keyDown(header, { key: 'ArrowRight', shiftKey: true, bubbles: true });

    expect(onSizeChange).toHaveBeenCalledWith({ width: 408, height: 600 });
  });
});

// ── Drag handle keyboard accessibility ───────────────────────────────────
// The drag handle is keyboard-focusable (tabIndex=0) so that Arrow-key
// panel repositioning is reachable without a pointer device (WCAG 2.1 §2.1.1).

describe('FloatingPanel — drag handle a11y', () => {
  it('drag handle is in the tab order and has an accessible label', () => {
    renderFloatingPanel({ title: 'Airo' });
    const handle = document.querySelector(
      '.airo-surfaces-panel-chrome__drag-handle',
    ) as HTMLElement;
    expect(handle).toBeInTheDocument();
    expect(handle).toHaveAttribute('tabindex', '0');
    expect(handle).toHaveAccessibleName();
  });

  it('moves the panel when ArrowRight is pressed with focus on the drag handle', () => {
    const onPositionChange = vi.fn();
    renderFloatingPanel({ position: { x: 100, y: 100 }, onPositionChange });

    const handle = document.querySelector(
      '.airo-surfaces-panel-chrome__drag-handle',
    ) as HTMLElement;
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowRight', bubbles: true });

    expect(onPositionChange).toHaveBeenCalledWith({ x: 108, y: 100 });
  });

  it('resizes the panel when Shift+ArrowRight is pressed with focus on the drag handle', () => {
    const onSizeChange = vi.fn();
    renderFloatingPanel({ size: { width: 400, height: 600 }, onSizeChange });

    const handle = document.querySelector(
      '.airo-surfaces-panel-chrome__drag-handle',
    ) as HTMLElement;
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true, bubbles: true });

    expect(onSizeChange).toHaveBeenCalledWith({ width: 408, height: 600 });
  });

  it('accepts a custom dragHandleLabel', () => {
    renderFloatingPanel({ title: 'Airo', dragHandleLabel: 'Drag to move' });
    const handle = document.querySelector(
      '.airo-surfaces-panel-chrome__drag-handle',
    ) as HTMLElement;
    expect(handle).toHaveAttribute('aria-label', 'Drag to move');
  });
});

// ── Expand / collapse (full-screen toggle) ────────────────────────────────

describe('FloatingPanel — expand / collapse', () => {
  it('renders --expanded class when defaultExpanded is true', () => {
    renderFloatingPanel({ defaultExpanded: true });
    const panel = document.querySelector('.airo-surfaces-floating-panel');
    expect(panel).toHaveClass('airo-surfaces-floating-panel--expanded');
  });

  it('does not render --expanded class when defaultExpanded is false', () => {
    renderFloatingPanel({ defaultExpanded: false });
    const panel = document.querySelector('.airo-surfaces-floating-panel');
    expect(panel).not.toHaveClass('airo-surfaces-floating-panel--expanded');
  });

  it('renders --expanded class when expanded prop is true (controlled)', () => {
    renderFloatingPanel({ expanded: true });
    const panel = document.querySelector('.airo-surfaces-floating-panel');
    expect(panel).toHaveClass('airo-surfaces-floating-panel--expanded');
  });

  it('shows collapse and close buttons in expanded mode', () => {
    renderFloatingPanel({ defaultExpanded: true });
    expect(screen.getByRole('button', { name: /collapse/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('does not show the rnd root when expanded (floating → expanded)', () => {
    renderFloatingPanel({ defaultExpanded: true });
    expect(screen.queryByTestId('rnd-root')).not.toBeInTheDocument();
  });

  it('uses custom collapseLabel in expanded mode', () => {
    renderFloatingPanel({ defaultExpanded: true, collapseLabel: 'Exit full screen' });
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeInTheDocument();
  });

  it('clicking collapse button exits expanded mode (uncontrolled)', async () => {
    renderFloatingPanel({ defaultExpanded: true });
    await userEvent.click(screen.getByRole('button', { name: /collapse/i }));
    const panel = document.querySelector('.airo-surfaces-floating-panel');
    expect(panel).not.toHaveClass('airo-surfaces-floating-panel--expanded');
    // After collapsing a floating panel, Rnd should be back
    expect(screen.getByTestId('rnd-root')).toBeInTheDocument();
  });

  it('fires onExpandedChange(true) when expanding and onExpandedChange(false) when collapsing', async () => {
    const onExpandedChange = vi.fn();
    // Start floating so PanelChrome's default expand button is present
    renderFloatingPanel({ onExpandedChange });
    // PanelChrome renders the expand button in default cornerActions
    const expandBtn = screen.getByRole('button', { name: /expand/i });
    await userEvent.click(expandBtn);
    expect(onExpandedChange).toHaveBeenCalledWith(true);

    await userEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });

  it('shows expand and close buttons in docked mode', () => {
    renderFloatingPanel({ defaultDockedTo: 'right' });
    expect(screen.getByRole('button', { name: /expand/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('expands from docked mode when expand button is clicked', async () => {
    renderFloatingPanel({ defaultDockedTo: 'right' });
    await userEvent.click(screen.getByRole('button', { name: /expand/i }));
    const panel = document.querySelector('.airo-surfaces-floating-panel');
    expect(panel).toHaveClass('airo-surfaces-floating-panel--expanded');
  });

  it('restores docked state after collapsing from docked expansion', async () => {
    renderFloatingPanel({ defaultDockedTo: 'left' });
    // Expand from docked-left
    await userEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(document.querySelector('.airo-surfaces-floating-panel--expanded')).toBeInTheDocument();

    // Collapse — should return to docked-left
    await userEvent.click(screen.getByRole('button', { name: /collapse/i }));
    const panel = document.querySelector('.airo-surfaces-floating-panel');
    expect(panel).toHaveClass('airo-surfaces-floating-panel--docked-left');
    expect(panel).not.toHaveClass('airo-surfaces-floating-panel--expanded');
  });

  it('uses custom expandLabel on the docked expand button', () => {
    renderFloatingPanel({ defaultDockedTo: 'right', expandLabel: 'Full screen' });
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
  });

  it('fires onExpandedChange when expanding from docked mode', async () => {
    const onExpandedChange = vi.fn();
    renderFloatingPanel({ defaultDockedTo: 'right', onExpandedChange });
    await userEvent.click(screen.getByRole('button', { name: /expand/i }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
  });

  it('drag handle is hidden in expanded mode (dragHandle=false)', () => {
    renderFloatingPanel({ defaultExpanded: true });
    // When dragHandle=false PanelChrome omits the pill element
    const handle = document.querySelector('.airo-surfaces-panel-chrome__drag-handle');
    expect(handle).not.toBeInTheDocument();
  });
});

// ── Drag + resize callbacks (Rnd integration) ─────────────────────────────

describe('FloatingPanel — drag and resize handlers', () => {
  it('invokes handleDrag without throwing (snap-target update path)', () => {
    renderFloatingPanel();
    // onDrag only updates internal snap-target state; it does not call
    // onPositionChange. Verifying it runs without error is sufficient.
    expect(() => rndCallbacks.onDrag?.({}, { x: 200, y: 150 })).not.toThrow();
  });

  it('fires onPositionChange via the Rnd onDragStop callback (no snap)', () => {
    const onPositionChange = vi.fn();
    renderFloatingPanel({ onPositionChange });
    // x=300, width=384 → right edge=684, viewport=1024, threshold=80 → no snap
    rndCallbacks.onDragStop?.({}, { x: 300, y: 50 });
    expect(onPositionChange).toHaveBeenCalledWith({ x: 300, y: 50 });
  });

  it('fires onSizeChange via the Rnd onResizeStop callback', () => {
    const onSizeChange = vi.fn();
    renderFloatingPanel({ onSizeChange });
    const fakeEl = document.createElement('div');
    Object.defineProperty(fakeEl, 'offsetWidth', { value: 480 });
    Object.defineProperty(fakeEl, 'offsetHeight', { value: 640 });
    rndCallbacks.onResizeStop?.({}, 'right', fakeEl, {}, { x: 0, y: 0 });
    expect(onSizeChange).toHaveBeenCalledWith({ width: 480, height: 640 });
  });
});

// ── Docked-edge resize ────────────────────────────────────────────────────
// When the panel is snapped to a viewport edge, an edge-resize handle appears.
// Dragging it fires onSizeChange with an updated width. The handle must NOT
// appear in non-docked (floating) state.

describe('FloatingPanel — docked-edge resize', () => {
  function patchPointerCapture(el: HTMLElement) {
    // jsdom stubs setPointerCapture/releasePointerCapture as no-ops; make sure
    // they exist so the handler doesn't throw, and track their calls.
    el.setPointerCapture = vi.fn();
    el.releasePointerCapture = vi.fn();
    el.hasPointerCapture = vi.fn().mockReturnValue(true);
  }

  it('does NOT render an edge resize handle when the panel is floating', () => {
    renderFloatingPanel({ show: true });
    expect(
      document.querySelector('.airo-surfaces-floating-panel__edge-resize-handle'),
    ).not.toBeInTheDocument();
  });

  it('renders an edge resize handle when docked to the left', () => {
    renderFloatingPanel({ show: true, defaultDockedTo: 'left' });
    expect(
      document.querySelector('.airo-surfaces-floating-panel__edge-resize-handle'),
    ).toBeInTheDocument();
  });

  it('calls onSizeChange with updated width on pointer drag when docked left', () => {
    const onSizeChange = vi.fn();
    renderFloatingPanel({
      show: true,
      defaultDockedTo: 'left',
      size: { width: 320, height: 600 },
      onSizeChange,
    });

    const handle = document.querySelector(
      '.airo-surfaces-floating-panel__edge-resize-handle',
    ) as HTMLElement;
    patchPointerCapture(handle);

    // pointerdown at x=300, then move right by 40px.
    fireEvent(
      handle,
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        clientX: 300,
      }),
    );
    fireEvent(
      handle,
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        clientX: 340,
      }),
    );

    // docked-left: new width = startWidth + dx = 320 + 40 = 360
    expect(onSizeChange).toHaveBeenCalledWith({ width: 360, height: 600 });
  });

  it('calls onSizeChange with updated width on pointer drag when docked right', () => {
    const onSizeChange = vi.fn();
    renderFloatingPanel({
      show: true,
      defaultDockedTo: 'right',
      size: { width: 320, height: 600 },
      onSizeChange,
    });

    const handle = document.querySelector(
      '.airo-surfaces-floating-panel__edge-resize-handle',
    ) as HTMLElement;
    patchPointerCapture(handle);

    // pointerdown at x=300, then move LEFT by 40px (docked-right: dx is negated).
    fireEvent(
      handle,
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        clientX: 300,
      }),
    );
    fireEvent(
      handle,
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        clientX: 260,
      }),
    );

    // docked-right: new width = startWidth + (-dx) = 320 + -(-40) = 320 + 40 = 360
    expect(onSizeChange).toHaveBeenCalledWith({ width: 360, height: 600 });
  });
});
