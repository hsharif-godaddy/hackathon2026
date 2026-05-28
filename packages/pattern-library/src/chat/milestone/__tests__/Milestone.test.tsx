import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { Milestone } from '../index';

beforeAll(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.href;

    if (url.includes('/ux-assets/@ux/icon/')) {
      return Promise.resolve(
        new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        }),
      );
    }

    return Promise.reject(new Error(`Unexpected fetch in Milestone tests: ${url}`));
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('Milestone', () => {
  describe('label-only', () => {
    it('renders the label', () => {
      render(<Milestone label="Saved your changes" />);
      expect(screen.getByText('Saved your changes')).toBeInTheDocument();
    });

    it('does not render a disclosure trigger when there is no panel content', () => {
      const { container } = render(<Milestone label="Saved your changes" />);
      expect(container.querySelector('.airo-chat-milestone__label-button')).not.toBeInTheDocument();
      expect(container.querySelector('.airo-chat-milestone__panel')).not.toBeInTheDocument();
    });

    it('forwards className and data-* to the root', () => {
      const { container } = render(
        <Milestone label="Saved" className="extra" data-testid="root" />,
      );
      const root = container.querySelector('.airo-chat-milestone');
      expect(root).toHaveClass('extra');
      expect(root).toHaveAttribute('data-testid', 'root');
    });
  });

  describe('disclosure', () => {
    const panelContent = <div data-testid="panel-body">Reasoning details</div>;

    it('renders the panel before the label-button in DOM order', () => {
      const { container } = render(<Milestone label="Done">{panelContent}</Milestone>);
      const panel = container.querySelector('.airo-chat-milestone__panel');
      const labelButton = container.querySelector('.airo-chat-milestone__label-button');
      if (!panel || !labelButton) throw new Error('panel and label button must exist');
      expect(
        panel.compareDocumentPosition(labelButton) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('starts closed by default and exposes aria-expanded / aria-controls', () => {
      render(<Milestone label="Done">{panelContent}</Milestone>);
      const toggle = screen.getByRole('button', { name: /Done/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const controls = toggle.getAttribute('aria-controls');
      expect(controls).toBeTruthy();
      const panel = document.getElementById(controls ?? '');
      expect(panel).toHaveAttribute('hidden');
    });

    it('opens the panel and flips aria-expanded when the label is clicked (uncontrolled)', async () => {
      const user = userEvent.setup();
      render(<Milestone label="Done">{panelContent}</Milestone>);
      const toggle = screen.getByRole('button', { name: /Done/ });
      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
      expect(panel).not.toHaveAttribute('hidden');
    });

    it('respects defaultOpen', () => {
      render(
        <Milestone label="Done" defaultOpen>
          {panelContent}
        </Milestone>,
      );
      const toggle = screen.getByRole('button', { name: /Done/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });

    it('drives state via `open` when controlled and fires onOpenChange', async () => {
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      const { rerender } = render(
        <Milestone label="Done" open={false} onOpenChange={onOpenChange}>
          {panelContent}
        </Milestone>,
      );
      const toggle = screen.getByRole('button', { name: /Done/ });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      await user.click(toggle);
      expect(onOpenChange).toHaveBeenCalledWith(true);
      // Until the consumer flips `open`, the trigger reflects the
      // controlled value (false) — proving the controlled/uncontrolled
      // parity isn't accidentally falling through to internal state.
      expect(toggle).toHaveAttribute('aria-expanded', 'false');

      rerender(
        <Milestone label="Done" open onOpenChange={onOpenChange}>
          {panelContent}
        </Milestone>,
      );
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('actions', () => {
    it('renders inline actions as buttons with the action label', () => {
      const onSelect = vi.fn();
      render(<Milestone label="Saved" actions={[{ id: 'view', label: 'View', onSelect }]} />);
      expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    });

    it('fires onSelect when an inline action is clicked', async () => {
      const onSelect = vi.fn();
      const user = userEvent.setup();
      render(<Milestone label="Saved" actions={[{ id: 'view', label: 'View', onSelect }]} />);
      await user.click(screen.getByRole('button', { name: 'View' }));
      expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('does not render the ellipsis menu when no overflow / overflow-priority actions exist', () => {
      const { container } = render(
        <Milestone
          label="Saved"
          actions={[
            { id: 'a', label: 'A', onSelect: vi.fn(), priority: 'always' },
            { id: 'b', label: 'B', onSelect: vi.fn(), priority: 'always' },
          ]}
        />,
      );
      // The ellipsis MenuButton would carry `aria-label="More actions"` —
      // its absence is the proof that no overflow region rendered.
      expect(screen.queryByRole('button', { name: /more actions/i })).not.toBeInTheDocument();
      expect(
        container.querySelector('.airo-chat-milestone__action--collapsed'),
      ).not.toBeInTheDocument();
    });

    it('renders the ellipsis menu when at least one overflow-priority action exists', () => {
      render(
        <Milestone
          label="Saved"
          actions={[
            { id: 'view', label: 'View', onSelect: vi.fn() },
            { id: 'delete', label: 'Delete', onSelect: vi.fn(), priority: 'overflow' },
          ]}
        />,
      );
      expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument();
    });

    it('honors a custom menuLabel', () => {
      render(
        <Milestone
          label="Saved"
          menuLabel="Other actions"
          actions={[
            { id: 'view', label: 'View', onSelect: vi.fn() },
            { id: 'delete', label: 'Delete', onSelect: vi.fn(), priority: 'overflow' },
          ]}
        />,
      );
      expect(screen.getByRole('button', { name: 'Other actions' })).toBeInTheDocument();
    });

    it('always-priority actions never collapse', () => {
      render(
        <Milestone
          label="Saved"
          actions={[
            { id: 'undo', label: 'Undo', onSelect: vi.fn(), priority: 'always' },
            { id: 'view', label: 'View', onSelect: vi.fn() },
          ]}
        />,
      );
      const undoButton = screen.getByRole('button', { name: 'Undo' });
      expect(undoButton).not.toHaveClass('airo-chat-milestone__action--collapsed');
    });

    it('opens the overflow menu on click and fires onSelect when a menu item is clicked', async () => {
      const onArchive = vi.fn();
      const user = userEvent.setup();
      render(
        <Milestone
          label="Saved"
          actions={[
            { id: 'view', label: 'View', onSelect: vi.fn() },
            { id: 'archive', label: 'Archive', onSelect: onArchive, priority: 'overflow' },
          ]}
        />,
      );
      await user.click(screen.getByRole('button', { name: /more actions/i }));
      const item = await screen.findByRole('menuitem', { name: 'Archive' });
      // `@ux/menu` gates `mouseUp` selection behind a `readyToSelect`
      // flag that flips to `true` either 400ms after open or on item
      // focus. Focusing the item synchronously satisfies the gate so
      // the click test exercises the production path without leaning
      // on fake timers.
      item.focus();
      await user.click(item);
      expect(onArchive).toHaveBeenCalledTimes(1);
    });

    it('opens the overflow menu via keyboard and fires onSelect when a menu item is keyboard-activated', async () => {
      const onArchive = vi.fn();
      const user = userEvent.setup();
      render(
        <Milestone
          label="Saved"
          actions={[{ id: 'archive', label: 'Archive', onSelect: onArchive, priority: 'overflow' }]}
        />,
      );
      const trigger = screen.getByRole('button', { name: /more actions/i });
      trigger.focus();
      await user.keyboard('{Enter}');
      // `@ux/menu` puts DOM focus on the list wrapper (not on
      // individual items) and resolves Enter / Space against the
      // active index, so we wait for the menu to render and then
      // press Enter on the focused list to activate the first item.
      await screen.findByRole('menuitem', { name: 'Archive' });
      await user.keyboard('{Enter}');
      expect(onArchive).toHaveBeenCalledTimes(1);
    });

    it('collapses auto-priority actions into the overflow menu when the row overflows', () => {
      // The convergence loop in `useOverflowMeasure` reads `scrollWidth`
      // and `clientWidth` off the actions row. jsdom's layout engine is a
      // no-op, so we have to stub those readouts to exercise the production
      // overflow path. Forcing a permanent overflow (`scrollWidth >
      // clientWidth`) drives `inlineAutoCount` down to 0; every auto
      // action ends up with the `--collapsed` modifier and the ellipsis
      // trigger renders.
      const scrollWidthSpy = vi
        .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
        .mockReturnValue(400);
      const clientWidthSpy = vi
        .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
        .mockReturnValue(100);
      try {
        render(
          <Milestone
            label="Saved"
            actions={[
              { id: 'a', label: 'A', onSelect: vi.fn() },
              { id: 'b', label: 'B', onSelect: vi.fn() },
              { id: 'c', label: 'C', onSelect: vi.fn() },
            ]}
          />,
        );
        expect(screen.getByRole('button', { name: /more actions/i })).toBeInTheDocument();
        for (const label of ['A', 'B', 'C']) {
          expect(screen.getByRole('button', { name: label })).toHaveClass(
            'airo-chat-milestone__action--collapsed',
          );
        }
      } finally {
        scrollWidthSpy.mockRestore();
        clientWidthSpy.mockRestore();
      }
    });
  });

  describe('feedback (via prop)', () => {
    it('does not render feedback buttons when `feedback` is undefined', () => {
      render(<Milestone label="Done" />);
      expect(screen.queryByRole('button', { name: /good response/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /bad response/i })).not.toBeInTheDocument();
    });

    it('renders thumbs-up and thumbs-down buttons when feedback is provided', () => {
      render(<Milestone label="Done" feedback={{}} />);
      expect(screen.getByRole('button', { name: /good response/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /bad response/i })).toBeInTheDocument();
    });
  });

  describe('feedback (uncontrolled)', () => {
    it('toggles thumbs-up between pressed states', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Milestone label="Done" feedback={{ onChange }} />);

      const upButton = screen.getByRole('button', { name: /good response/i });
      expect(upButton).toHaveAttribute('aria-pressed', 'false');

      await user.click(upButton);
      expect(upButton).toHaveAttribute('aria-pressed', 'true');
      expect(onChange).toHaveBeenLastCalledWith('up', undefined);

      await user.click(upButton);
      expect(upButton).toHaveAttribute('aria-pressed', 'false');
      expect(onChange).toHaveBeenLastCalledWith(null, undefined);
    });

    it('switches up → down (mutual exclusivity)', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Milestone label="Done" feedback={{ onChange }} />);
      const up = screen.getByRole('button', { name: /good response/i });
      const down = screen.getByRole('button', { name: /bad response/i });

      await user.click(up);
      expect(up).toHaveAttribute('aria-pressed', 'true');

      await user.click(down);
      expect(up).toHaveAttribute('aria-pressed', 'false');
      expect(down).toHaveAttribute('aria-pressed', 'true');
      expect(onChange).toHaveBeenLastCalledWith('down', undefined);
    });

    it('thumbs-down works as a plain toggle when downReasons is empty', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Milestone label="Done" feedback={{ onChange, downReasons: [] }} />);

      const down = screen.getByRole('button', { name: /bad response/i });
      await user.click(down);
      expect(down).toHaveAttribute('aria-pressed', 'true');
      await user.click(down);
      expect(down).toHaveAttribute('aria-pressed', 'false');
      expect(onChange).toHaveBeenLastCalledWith(null, undefined);
    });

    it('respects defaultValue', () => {
      render(<Milestone label="Done" feedback={{ defaultValue: 'up' }} />);
      expect(screen.getByRole('button', { name: /good response/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  describe('feedback (controlled)', () => {
    it('drives the pressed state via `value` regardless of internal clicks', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Milestone label="Done" feedback={{ value: null, onChange }} />);

      const up = screen.getByRole('button', { name: /good response/i });
      expect(up).toHaveAttribute('aria-pressed', 'false');
      await user.click(up);
      // onChange fires; pressed stays 'false' until consumer flips `value`.
      expect(onChange).toHaveBeenCalledWith('up', undefined);
      expect(up).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('Milestone.Feedback (standalone)', () => {
    it('renders without a parent Milestone', () => {
      render(<Milestone.Feedback />);
      expect(screen.getByRole('button', { name: /good response/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /bad response/i })).toBeInTheDocument();
    });

    it('forwards className to its root', () => {
      const { container } = render(<Milestone.Feedback className="my-feedback" />);
      const root = container.querySelector('.airo-chat-milestone-feedback');
      expect(root).toHaveClass('my-feedback');
    });

    it('honors thumbsUpLabel and thumbsDownLabel', () => {
      render(<Milestone.Feedback thumbsUpLabel="Helpful" thumbsDownLabel="Not helpful" />);
      expect(screen.getByRole('button', { name: 'Helpful' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Not helpful' })).toBeInTheDocument();
    });
  });

  describe('feedback (with reason picker)', () => {
    const reasons = [
      { id: 'wrong', label: 'Incorrect' },
      { id: 'unsafe', label: 'Unsafe' },
    ];

    it('marks down as pressed once clicked, even before a reason is picked', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Milestone label="Done" feedback={{ downReasons: reasons, onChange }} />);

      const down = screen.getByRole('button', { name: /bad response/i });
      await user.click(down);
      expect(down).toHaveAttribute('aria-pressed', 'true');
      expect(onChange).toHaveBeenLastCalledWith('down', undefined);
    });

    it('opens the reason picker via keyboard and fires onChange with the reason id', async () => {
      const onChange = vi.fn();
      const user = userEvent.setup();
      render(<Milestone label="Done" feedback={{ downReasons: reasons, onChange }} />);

      const down = screen.getByRole('button', { name: /bad response/i });
      down.focus();
      await user.keyboard('{Enter}');
      // Same focus-on-list keyboard model as the action overflow menu
      // — Enter on the focused list activates the first reason.
      await screen.findByRole('menuitem', { name: 'Incorrect' });
      await user.keyboard('{Enter}');
      expect(onChange).toHaveBeenLastCalledWith('down', 'wrong');
    });
  });

  describe('panel content composition', () => {
    it('renders both reasoningBlock and children inside the same panel', () => {
      render(
        <Milestone
          label="Done"
          defaultOpen
          reasoningBlock={<div data-testid="reasoning">reasoning</div>}
        >
          <div data-testid="checklist">checklist</div>
        </Milestone>,
      );
      const toggle = screen.getByRole('button', { name: /Done/ });
      const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
      expect(panel).not.toBeNull();
      const inPanel = within(panel as HTMLElement);
      expect(inPanel.getByTestId('reasoning')).toBeInTheDocument();
      expect(inPanel.getByTestId('checklist')).toBeInTheDocument();
    });
  });
});
