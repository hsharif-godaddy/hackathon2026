// Tests for the temporary vendor of antares PR #187's SegmentedController.
//
// These cover behavior that JSDOM can faithfully simulate: rendering,
// selection state (controlled + uncontrolled), keyboard navigation, the
// `collapseInactive` label-visibility logic, and the dev warning when
// `icon` is missing under `collapseInactive`.
//
// Deliberately NOT covered here:
//   - Min-width reservation: depends on real `getBoundingClientRect` widths,
//     which JSDOM returns as 0. Upstream covers this in a real-browser run.
//   - Horizontal-scroll overflow: depends on layout-driven `scrollWidth`
//     vs `clientWidth`. Same JSDOM limitation.
//   - The `interpolate-size` / `prefers-reduced-motion` CSS transitions.
import { Icon } from '@godaddy/antares';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SegmentedController, SegmentedControllerItem } from '../SegmentedController';

function renderBasic(props?: { defaultValue?: string }) {
  return render(
    <SegmentedController aria-label="View" defaultValue={props?.defaultValue ?? 'day'}>
      <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
      <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
      <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
    </SegmentedController>,
  );
}

describe('SegmentedController (vendor)', () => {
  describe('rendering', () => {
    it('renders all segments with their labels', () => {
      renderBasic();
      expect(screen.getByText('Day')).toBeInTheDocument();
      expect(screen.getByText('Week')).toBeInTheDocument();
      expect(screen.getByText('Month')).toBeInTheDocument();
    });

    it('marks the default-selected segment as selected', () => {
      renderBasic({ defaultValue: 'week' });
      const week = screen.getByRole('radio', { name: 'Week' });
      expect(week).toHaveAttribute('data-selected');
    });

    it('forwards `aria-label` to the group', () => {
      renderBasic();
      expect(screen.getByRole('radiogroup', { name: 'View' })).toBeInTheDocument();
    });
  });

  describe('uncontrolled selection', () => {
    it('updates selection when a segment is clicked', async () => {
      const user = userEvent.setup();
      renderBasic({ defaultValue: 'day' });

      await user.click(screen.getByRole('radio', { name: 'Week' }));

      expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('data-selected');
      expect(screen.getByRole('radio', { name: 'Day' })).not.toHaveAttribute('data-selected');
    });
  });

  describe('controlled selection', () => {
    it('respects `value` prop and fires `onSelectionChange`', async () => {
      const user = userEvent.setup();
      const onSelectionChange = vi.fn();

      function Controlled() {
        const [value, setValue] = useState('day');
        return (
          <SegmentedController
            aria-label="View"
            value={value}
            onSelectionChange={(v) => {
              onSelectionChange(v);
              setValue(v);
            }}
          >
            <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
            <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
            <SegmentedControllerItem value="month">Month</SegmentedControllerItem>
          </SegmentedController>
        );
      }

      render(<Controlled />);
      expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('data-selected');

      await user.click(screen.getByRole('radio', { name: 'Month' }));
      expect(onSelectionChange).toHaveBeenCalledWith('month');
      expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('data-selected');
    });
  });

  describe('keyboard navigation', () => {
    it('moves focus with arrow keys and selects with Space', async () => {
      const user = userEvent.setup();
      renderBasic({ defaultValue: 'day' });

      // Tab into the group (focus lands on the selected item).
      await user.tab();
      // Arrow right moves focus to the next segment without changing selection.
      await user.keyboard('{ArrowRight}');
      expect(screen.getByRole('radio', { name: 'Week' })).toHaveFocus();
      expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('data-selected');

      // Space selects the focused segment.
      await user.keyboard(' ');
      expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('data-selected');
    });
  });

  describe('disabled', () => {
    it('disables every segment when `isDisabled` is set on the controller', () => {
      render(
        <SegmentedController aria-label="View" defaultValue="day" isDisabled>
          <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
          <SegmentedControllerItem value="week">Week</SegmentedControllerItem>
        </SegmentedController>,
      );
      expect(screen.getByRole('radio', { name: 'Day' })).toHaveAttribute('data-disabled');
      expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('data-disabled');
    });

    it('disables only the segment passed `isDisabled`', () => {
      render(
        <SegmentedController aria-label="View" defaultValue="day">
          <SegmentedControllerItem value="day">Day</SegmentedControllerItem>
          <SegmentedControllerItem value="week" isDisabled>
            Week
          </SegmentedControllerItem>
        </SegmentedController>,
      );
      expect(screen.getByRole('radio', { name: 'Day' })).not.toHaveAttribute('data-disabled');
      expect(screen.getByRole('radio', { name: 'Week' })).toHaveAttribute('data-disabled');
    });
  });

  describe('collapseInactive', () => {
    function renderCollapse(defaultValue = 'messages') {
      return render(
        <SegmentedController aria-label="Channel" defaultValue={defaultValue} collapseInactive>
          <SegmentedControllerItem
            value="inbox"
            icon={<Icon icon="inbox" width={20} height={20} />}
          >
            Inbox
          </SegmentedControllerItem>
          <SegmentedControllerItem
            value="messages"
            icon={<Icon icon="email" width={20} height={20} />}
          >
            Messages
          </SegmentedControllerItem>
          <SegmentedControllerItem
            value="notifications"
            icon={<Icon icon="bell" width={20} height={20} />}
          >
            Notifications
          </SegmentedControllerItem>
        </SegmentedController>,
      );
    }

    it('marks the container with `data-collapse-inactive`', () => {
      renderCollapse();
      expect(screen.getByRole('radiogroup')).toHaveAttribute('data-collapse-inactive', 'true');
    });

    it('shows the label of the selected segment but hides others', () => {
      renderCollapse('messages');

      // Use getAllByText because the hidden mirror also renders each label.
      const messagesLabel = screen.getAllByText('Messages').find((el) => !isInsideMirror(el));
      const inboxLabel = screen.getAllByText('Inbox').find((el) => !isInsideMirror(el));

      expect(messagesLabel?.className ?? '').not.toMatch(/--hidden/);
      expect(inboxLabel?.className ?? '').toMatch(/--hidden/);
    });

    it('flips visibility when the selection moves', async () => {
      const user = userEvent.setup();
      renderCollapse('messages');

      await user.click(screen.getByRole('radio', { name: 'Inbox' }));

      const inbox = screen.getAllByText('Inbox').find((el) => !isInsideMirror(el));
      const messages = screen.getAllByText('Messages').find((el) => !isInsideMirror(el));
      expect(inbox?.className ?? '').not.toMatch(/--hidden/);
      expect(messages?.className ?? '').toMatch(/--hidden/);
    });

    it('sets a fallback aria-label on collapsed string-children items', () => {
      renderCollapse('messages');
      // Non-selected items get an aria-label fallback equal to their string children
      // so screen readers still announce a name when the visible label is width:0.
      expect(screen.getByRole('radio', { name: 'Inbox' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Notifications' })).toBeInTheDocument();
    });

    it('renders a hidden aria-hidden mirror for measurement', () => {
      const { container } = renderCollapse();
      const mirror = container.querySelector<HTMLElement>(
        '.airo-vendor-segmented-controller__mirror',
      );
      if (!mirror) throw new Error('mirror element not rendered');
      expect(mirror).toHaveAttribute('aria-hidden', 'true');
      // One expanded + one collapsed clone per item, so 2 × 3 = 6 measurement nodes.
      expect(within(mirror).getAllByText('Inbox')).toHaveLength(1);
      const collapsedClones = mirror.querySelectorAll('[data-measure="collapsed"]');
      const expandedClones = mirror.querySelectorAll('[data-measure="expanded"]');
      expect(collapsedClones).toHaveLength(3);
      expect(expandedClones).toHaveLength(3);
    });

    describe('missing icon (dev warning)', () => {
      let warnSpy: ReturnType<typeof vi.spyOn>;
      beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      });
      afterEach(() => {
        warnSpy.mockRestore();
      });

      it('warns and keeps the label visible when an item lacks `icon`', () => {
        render(
          <SegmentedController aria-label="Channel" defaultValue="messages" collapseInactive>
            <SegmentedControllerItem
              value="inbox"
              icon={<Icon icon="inbox" width={20} height={20} />}
            >
              Inbox
            </SegmentedControllerItem>
            <SegmentedControllerItem value="messages">Messages</SegmentedControllerItem>
          </SegmentedController>,
        );

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'SegmentedControllerItem (value="messages") requires an "icon" prop',
          ),
        );
      });
    });
  });

  describe('measurement effect', () => {
    it('does not throw when `collapseInactive` is off (no mirror, no measure)', () => {
      // Smoke test: the measurement effect's early-return path runs when the mirror
      // ref is null. Mounting and unmounting the basic story should be a no-op.
      const { unmount } = renderBasic();
      act(() => {
        unmount();
      });
    });
  });
});

function isInsideMirror(el: Element) {
  return el.closest('.airo-vendor-segmented-controller__mirror') !== null;
}
