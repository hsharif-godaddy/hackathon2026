import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { CommandPalette, type CommandPaletteProps } from '../index';

// `@ux/flyout` (desktop popover) and `@ux/disrupt` (mobile BottomSheet) rely on
// layout/portal behavior that does not render under the React 19 peers in
// jsdom. Passthrough mocks render their children inline so the palette's logic
// is testable on both surfaces.
vi.mock('@ux/flyout', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@ux/disrupt', () => ({
  default: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

const trigger = { 'aria-label': 'Open command palette', 'data-testid': 'trigger' } as const;

function palette(): ReactNode {
  return (
    <>
      <CommandPalette.Search aria-label="Search commands" placeholder="Type a command…" hotkeyHint="⌘/" />
      <CommandPalette.Cards aria-label="Quick actions">
        <CommandPalette.Card id="attach" icon={<span />} title="Attach" />
        <CommandPalette.Card id="screenshot" icon={<span />} title="Screenshot" />
        <CommandPalette.Card id="reference" icon={<span />} title="Reference a file" />
      </CommandPalette.Cards>
      <CommandPalette.Group id="prompts" heading="Prompts">
        <CommandPalette.Item id="p1" icon={<span />}>
          Prompt 1
        </CommandPalette.Item>
      </CommandPalette.Group>
      <CommandPalette.Group id="pages" heading="Pages">
        <CommandPalette.Item id="about" icon={<span />} hotkey="G A" filterText="go to /about">
          Go to <CommandPalette.Muted>/about</CommandPalette.Muted>
        </CommandPalette.Item>
      </CommandPalette.Group>
    </>
  );
}

function renderCommandPalette(props?: Partial<CommandPaletteProps>) {
  return render(
    <CommandPalette isMobile={false} trigger={trigger} aria-label="Commands" {...props}>
      {palette()}
    </CommandPalette>,
  );
}

describe('CommandPalette', () => {
  describe('desktop', () => {
    it('renders only the named trigger when closed', () => {
      renderCommandPalette();
      expect(screen.getByTestId('trigger')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('opens the popover on trigger click', async () => {
      const user = userEvent.setup();
      renderCommandPalette();
      await user.click(screen.getByTestId('trigger'));
      expect(screen.getByRole('combobox', { name: 'Search commands' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Attach' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Go to \/about/ })).toBeInTheDocument();
    });

    it('places the search in the top box and the options in the listbox (fragment-wrapped slots)', async () => {
      const user = userEvent.setup();
      // `palette()` returns its slots inside a fragment; the root must still
      // route the search into the search box and the cards/items into the
      // listbox (regression: Children.toArray does not flatten fragments).
      renderCommandPalette();
      await user.click(screen.getByTestId('trigger'));
      const searchBox: HTMLElement | null = document.querySelector(
        '.airo-input-command-palette__search-box',
      );
      const listbox: HTMLElement = screen.getByRole('listbox');
      expect(searchBox).not.toBeNull();
      expect(searchBox?.querySelector('[role="combobox"]')).not.toBeNull();
      expect(listbox.querySelector('[role="combobox"]')).toBeNull();
      expect(listbox.querySelector('.airo-input-command-palette__cards')).not.toBeNull();
    });

    it('filters cards and items, hiding empty groups', async () => {
      const user = userEvent.setup();
      renderCommandPalette({ defaultOpen: true });
      await user.type(screen.getByRole('combobox'), 'prompt');

      expect(screen.getByRole('option', { name: 'Prompt 1' })).toBeInTheDocument();
      // Non-matching cards and the Pages item drop out of the accessibility tree.
      expect(screen.queryByRole('option', { name: 'Attach' })).toBeNull();
      expect(screen.queryByRole('option', { name: /Go to \/about/ })).toBeNull();
    });

    it('matches a styled label through its filterText', async () => {
      const user = userEvent.setup();
      renderCommandPalette({ defaultOpen: true });
      await user.type(screen.getByRole('combobox'), 'about');
      expect(screen.getByRole('option', { name: /Go to \/about/ })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Prompt 1' })).toBeNull();
    });

    it('shows the empty state when nothing matches', async () => {
      const user = userEvent.setup();
      renderCommandPalette({ defaultOpen: true, emptyState: 'Nothing here' });
      await user.type(screen.getByRole('combobox'), 'zzzzz');
      expect(screen.getByText('Nothing here')).toBeInTheDocument();
      expect(screen.queryByRole('option')).toBeNull();
    });

    it('activates the highlighted option on Enter and closes when closeOnSelect', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const onOpenChange = vi.fn();
      renderCommandPalette({ defaultOpen: true, onSelect, onOpenChange });

      // Narrow to a single match so the highlighted option is order-independent.
      await user.type(screen.getByRole('combobox'), 'about');
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('about');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('moves the active-descendant highlight with the arrow keys', async () => {
      const user = userEvent.setup();
      renderCommandPalette({ defaultOpen: true });
      const combobox: HTMLElement = screen.getByRole('combobox');
      // Nothing is highlighted on an empty-query open — no option looks pre-selected.
      expect(combobox.getAttribute('aria-activedescendant')).toBeNull();

      await user.click(combobox);
      await user.keyboard('{ArrowDown}');
      // First ArrowDown lands on the first option (the first card).
      expect(combobox.getAttribute('aria-activedescendant')).toBe(
        screen.getByRole('option', { name: 'Attach' }).id,
      );

      await user.keyboard('{ArrowDown}');
      expect(combobox.getAttribute('aria-activedescendant')).toBe(
        screen.getByRole('option', { name: 'Screenshot' }).id,
      );
    });

    it('supports controlled search via onSearchChange', async () => {
      const user = userEvent.setup();
      const onSearchChange = vi.fn();

      function Controlled() {
        const [value, setValue] = useState('');
        return (
          <CommandPalette
            isMobile={false}
            trigger={trigger}
            aria-label="Commands"
            defaultOpen
            search={value}
            onSearchChange={(next: string) => {
              setValue(next);
              onSearchChange(next);
            }}
          >
            {palette()}
          </CommandPalette>
        );
      }
      render(<Controlled />);
      await user.type(screen.getByRole('combobox'), 'p');
      expect(onSearchChange).toHaveBeenCalledWith('p');
    });

    it('supports controlled open via onOpenChange (does not self-open)', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(
        <CommandPalette
          isMobile={false}
          trigger={trigger}
          aria-label="Commands"
          open={false}
          onOpenChange={onOpenChange}
        >
          {palette()}
        </CommandPalette>,
      );
      // Controlled-closed: clicking the trigger must request open, not self-open.
      await user.click(screen.getByTestId('trigger'));
      expect(onOpenChange).toHaveBeenCalledWith(true);
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('keeps the palette open after selection when closeOnSelect is false', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderCommandPalette({ defaultOpen: true, closeOnSelect: false, onSelect });
      await user.type(screen.getByRole('combobox'), 'about');
      await user.keyboard('{Enter}');
      expect(onSelect).toHaveBeenCalledWith('about');
      // closeOnSelect=false: the palette stays open after activation.
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('closes on Escape from the search field', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      renderCommandPalette({ defaultOpen: true, onOpenChange });
      const combobox: HTMLElement = screen.getByRole('combobox');
      await user.click(combobox);
      await user.keyboard('{Escape}');
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('fires each leaf onSelect on activation (card and item)', async () => {
      const user = userEvent.setup();
      const cardSelect = vi.fn();
      const itemSelect = vi.fn();
      render(
        <CommandPalette
          isMobile={false}
          trigger={trigger}
          aria-label="Commands"
          defaultOpen
          closeOnSelect={false}
        >
          <CommandPalette.Search aria-label="Search commands" />
          <CommandPalette.Cards aria-label="Quick actions">
            <CommandPalette.Card id="attach" icon={<span />} title="Attach" onSelect={cardSelect} />
          </CommandPalette.Cards>
          <CommandPalette.Group id="g" heading="Group">
            <CommandPalette.Item id="i1" icon={<span />} onSelect={itemSelect}>
              Item One
            </CommandPalette.Item>
          </CommandPalette.Group>
        </CommandPalette>,
      );
      await user.click(screen.getByRole('option', { name: 'Attach' }));
      await user.click(screen.getByRole('option', { name: 'Item One' }));
      expect(cardSelect).toHaveBeenCalledTimes(1);
      expect(itemSelect).toHaveBeenCalledTimes(1);
    });

    it('disables a leaf: aria-disabled, skipped by arrow nav, not activated', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      const disabledSelect = vi.fn();
      render(
        <CommandPalette
          isMobile={false}
          trigger={trigger}
          aria-label="Commands"
          defaultOpen
          onSelect={onSelect}
        >
          <CommandPalette.Search aria-label="Search commands" />
          <CommandPalette.Group id="g" heading="Group">
            <CommandPalette.Item id="enabled" icon={<span />}>
              Enabled
            </CommandPalette.Item>
            <CommandPalette.Item id="off" icon={<span />} disabled onSelect={disabledSelect}>
              Disabled
            </CommandPalette.Item>
          </CommandPalette.Group>
        </CommandPalette>,
      );
      const disabled: HTMLElement = screen.getByRole('option', { name: 'Disabled' });
      expect(disabled).toHaveAttribute('aria-disabled', 'true');

      // Click does not activate a disabled row.
      await user.click(disabled);
      expect(disabledSelect).not.toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();

      // Arrow nav skips the disabled row — the only navigable option is "Enabled",
      // so the highlight never lands on "Disabled".
      const combobox: HTMLElement = screen.getByRole('combobox');
      await user.click(combobox);
      await user.keyboard('{ArrowDown}');
      expect(combobox.getAttribute('aria-activedescendant')).toBe(
        screen.getByRole('option', { name: 'Enabled' }).id,
      );
      await user.keyboard('{ArrowDown}');
      expect(combobox.getAttribute('aria-activedescendant')).toBe(
        screen.getByRole('option', { name: 'Enabled' }).id,
      );
    });

    it('toggles aria-expanded on the trigger', async () => {
      const user = userEvent.setup();
      renderCommandPalette();
      const triggerEl: HTMLElement = screen.getByTestId('trigger');
      expect(triggerEl).toHaveAttribute('aria-expanded', 'false');
      await user.click(triggerEl);
      expect(triggerEl).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('mobile', () => {
    it('opens a chromeless bottom sheet (no title, no X) on trigger tap', async () => {
      const user = userEvent.setup();
      render(
        <CommandPalette isMobile trigger={trigger} aria-label="Commands">
          {palette()}
        </CommandPalette>,
      );
      expect(document.body.querySelector('.airo-surfaces-bottom-sheet__sheet')).toBeNull();
      await user.click(screen.getByTestId('trigger'));
      const sheet: HTMLElement | null = document.body.querySelector(
        '.airo-surfaces-bottom-sheet__sheet',
      );
      expect(sheet).not.toBeNull();
      expect(screen.getByRole('combobox', { name: 'Search commands' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Attach' })).toBeInTheDocument();
      // Chromeless: no header dismiss (X) button inside the sheet.
      expect(sheet?.querySelector('.airo-surfaces-bottom-sheet__header')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    });
  });
});
