import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ResponsiveMenu, type ResponsiveMenuItem } from '../index';

// `@ux/disrupt` (used by the mobile BottomSheet) does not render under the
// React 19 peers in jsdom — see the BottomSheet suite. Passthrough mock.
vi.mock('@ux/disrupt', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const baseItems: ResponsiveMenuItem[] = [
  { id: 'edit', label: 'Edit', href: '/edit', 'data-testid': 'row-edit' },
  { id: 'rename', label: 'Rename', onClick: vi.fn(), 'data-testid': 'row-rename' },
  {
    id: 'delete',
    label: 'Delete',
    emphasis: 'critical',
    separatorBefore: true,
    onClick: vi.fn(),
    'data-testid': 'row-delete',
  },
];

const trigger = { 'aria-label': 'Actions', 'data-testid': 'menu-trigger' } as const;

function querySheet(): HTMLElement | null {
  return document.body.querySelector('.airo-surfaces-bottom-sheet__sheet');
}

describe('ResponsiveMenu', () => {
  describe('desktop (isMobile=false)', () => {
    it('renders a trigger and no bottom sheet', () => {
      render(<ResponsiveMenu isMobile={false} trigger={trigger} items={baseItems} />);
      expect(screen.getByTestId('menu-trigger')).toBeInTheDocument();
      expect(querySheet()).toBeNull();
    });

    it('opens the @ux/menu flyout and fires an item handler exactly once on click', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      const items: ResponsiveMenuItem[] = [
        { id: 'rename', label: 'Rename', onClick, 'data-testid': 'row-rename' },
      ];
      render(<ResponsiveMenu isMobile={false} trigger={trigger} items={items} />);

      // Items live in the flyout, which is collapsed until the trigger opens it.
      await user.click(screen.getByTestId('menu-trigger'));
      await user.click(screen.getByTestId('row-rename'));

      // MenuItem wires both onClick (mouse) and onSelect (keyboard); the
      // desktop dedupe must collapse a single activation to one handler call.
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('forwards the menu-level onSelect with the @ux/menu (text, { id }) payload', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const items: ResponsiveMenuItem[] = [
        { id: 'rename', label: 'Rename', 'data-testid': 'row-rename' },
      ];
      render(
        <ResponsiveMenu isMobile={false} trigger={trigger} items={items} onSelect={onSelect} />,
      );

      // The menu-level `onSelect` payload is built by `@ux/menu`'s own select()
      // path, not by ResponsiveMenu — so drive that path rather than a bare DOM
      // click (which only hits the MenuItem `onClick`). @ux/menu arms selection
      // ~400ms after open or once an item is focused; `focus` arms it
      // immediately, then `mouseUp` triggers select() and the menu onSelect.
      await user.click(screen.getByTestId('menu-trigger'));
      const row: HTMLElement = screen.getByTestId('row-rename');
      fireEvent.focus(row);
      fireEvent.mouseUp(row);

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith('Rename', expect.objectContaining({ id: 'rename' }));
    });

    it('omits hidden items and never invokes a disabled item handler', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      const items: ResponsiveMenuItem[] = [
        { id: 'a', label: 'Visible', 'data-testid': 'row-a' },
        { id: 'b', label: 'Hidden', hidden: true, 'data-testid': 'row-b' },
        { id: 'c', label: 'Disabled', disabled: true, onClick, 'data-testid': 'row-c' },
      ];
      render(<ResponsiveMenu isMobile={false} trigger={trigger} items={items} />);
      await user.click(screen.getByTestId('menu-trigger'));

      expect(screen.getByTestId('row-a')).toBeInTheDocument();
      expect(screen.queryByTestId('row-b')).toBeNull();
      await user.click(screen.getByTestId('row-c'));
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('mobile (isMobile=true)', () => {
    it('opens a bottom sheet of rows when the trigger is tapped', () => {
      render(<ResponsiveMenu isMobile trigger={trigger} items={baseItems} />);
      expect(querySheet()).toBeNull();

      fireEvent.click(screen.getByTestId('menu-trigger'));

      expect(querySheet()).not.toBeNull();
      expect(screen.getByTestId('row-edit')).toBeInTheDocument();
      expect(screen.getByTestId('row-rename')).toBeInTheDocument();
      expect(screen.getByTestId('row-delete')).toBeInTheDocument();
    });

    it('runs trigger.onClick on tap and still opens the sheet', () => {
      const onTriggerClick = vi.fn();
      render(
        <ResponsiveMenu
          isMobile
          trigger={{ ...trigger, onClick: onTriggerClick }}
          items={baseItems}
        />,
      );
      expect(querySheet()).toBeNull();

      fireEvent.click(screen.getByTestId('menu-trigger'));

      // The trigger passthrough is how MilestoneFeedback toggles its
      // thumbs-down state; it must fire alongside the sheet opening.
      expect(onTriggerClick).toHaveBeenCalledTimes(1);
      expect(querySheet()).not.toBeNull();
    });

    it('names the sheet from a text-labelled trigger when no aria-label/sheetTitle', () => {
      render(
        <ResponsiveMenu
          isMobile
          trigger={{ text: 'Export', 'data-testid': 'menu-trigger' }}
          items={baseItems}
        />,
      );
      fireEvent.click(screen.getByTestId('menu-trigger'));
      expect(querySheet()).toHaveAttribute('aria-label', 'Export');
    });

    it('renders href items as links and others as buttons', () => {
      render(<ResponsiveMenu isMobile trigger={trigger} items={baseItems} />);
      fireEvent.click(screen.getByTestId('menu-trigger'));

      expect(screen.getByTestId('row-edit').tagName).toBe('A');
      expect(screen.getByTestId('row-edit')).toHaveAttribute('href', '/edit');
      expect(screen.getByTestId('row-rename').tagName).toBe('BUTTON');
    });

    it('fires onClick and onSelect, then closes when closeOnSelect (default)', () => {
      const onClick = vi.fn();
      const onSelect = vi.fn();
      const items: ResponsiveMenuItem[] = [
        { id: 'rename', label: 'Rename', onClick, 'data-testid': 'row-rename' },
      ];
      render(<ResponsiveMenu isMobile trigger={trigger} items={items} onSelect={onSelect} />);

      fireEvent.click(screen.getByTestId('menu-trigger'));
      fireEvent.click(screen.getByTestId('row-rename'));

      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(
        'Rename',
        expect.objectContaining({ id: 'rename' }),
      );
      expect(querySheet()).toBeNull();
    });

    it('keeps the sheet open when closeOnSelect is false', () => {
      render(
        <ResponsiveMenu
          isMobile
          closeOnSelect={false}
          trigger={trigger}
          items={[{ id: 'rename', label: 'Rename', onClick: vi.fn(), 'data-testid': 'row-rename' }]}
        />,
      );
      fireEvent.click(screen.getByTestId('menu-trigger'));
      fireEvent.click(screen.getByTestId('row-rename'));
      expect(querySheet()).not.toBeNull();
    });

    it('omits hidden items and disables disabled ones', () => {
      const onClick = vi.fn();
      const items: ResponsiveMenuItem[] = [
        { id: 'a', label: 'Visible', 'data-testid': 'row-a' },
        { id: 'b', label: 'Hidden', hidden: true, 'data-testid': 'row-b' },
        { id: 'c', label: 'Disabled', disabled: true, onClick, 'data-testid': 'row-c' },
      ];
      render(<ResponsiveMenu isMobile trigger={trigger} items={items} />);
      fireEvent.click(screen.getByTestId('menu-trigger'));

      expect(screen.getByTestId('row-a')).toBeInTheDocument();
      expect(screen.queryByTestId('row-b')).toBeNull();
      const disabled = screen.getByTestId('row-c');
      expect(disabled).toBeDisabled();
      fireEvent.click(disabled);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('marks critical rows with the modifier class and colors the critical icon', () => {
      const items: ResponsiveMenuItem[] = [
        { id: 'rename', label: 'Rename', icon: <span />, 'data-testid': 'row-rename' },
        {
          id: 'delete',
          label: 'Delete',
          icon: <span />,
          emphasis: 'critical',
          'data-testid': 'row-delete',
        },
      ];
      render(<ResponsiveMenu isMobile trigger={trigger} items={items} />);
      fireEvent.click(screen.getByTestId('menu-trigger'));
      const row: HTMLElement = screen.getByTestId('row-delete');
      // The `--critical` row class is a styling hook, not the visible color: the
      // critical feedback color is carried by the icon slot (`__icon--critical`)
      // and the `emphasis="critical"` label span, per styles.css.
      expect(row.className).toContain('airo-input-responsive-menu__row--critical');
      expect(row.querySelector('.airo-input-responsive-menu__icon--critical')).not.toBeNull();
    });

    it('reserves a leading icon slot on icon-less rows when any sibling has an icon', () => {
      const items: ResponsiveMenuItem[] = [
        { id: 'edit', label: 'Edit', icon: <span data-testid="icon-edit" />, 'data-testid': 'row-edit' },
        { id: 'rename', label: 'Rename', 'data-testid': 'row-rename' },
      ];
      render(<ResponsiveMenu isMobile trigger={trigger} items={items} />);
      fireEvent.click(screen.getByTestId('menu-trigger'));

      // The icon-less row still carries a slot, so its label aligns with the
      // labelled row's; the empty slot holds no icon of its own.
      const renameSlot: HTMLElement | null = screen
        .getByTestId('row-rename')
        .querySelector('.airo-input-responsive-menu__icon');
      expect(renameSlot).not.toBeNull();
      expect(renameSlot).toBeEmptyDOMElement();
      expect(
        screen.getByTestId('row-edit').querySelector('.airo-input-responsive-menu__icon'),
      ).not.toBeNull();
    });

    it('reserves no icon slot when no item has an icon', () => {
      const items: ResponsiveMenuItem[] = [
        { id: 'rename', label: 'Rename', 'data-testid': 'row-rename' },
        { id: 'settings', label: 'Settings', 'data-testid': 'row-settings' },
      ];
      render(<ResponsiveMenu isMobile trigger={trigger} items={items} />);
      fireEvent.click(screen.getByTestId('menu-trigger'));

      expect(
        screen.getByTestId('row-rename').querySelector('.airo-input-responsive-menu__icon'),
      ).toBeNull();
    });
  });
});
