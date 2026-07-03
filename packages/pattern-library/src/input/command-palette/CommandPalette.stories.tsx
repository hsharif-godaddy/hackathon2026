import type { Meta, StoryObj } from '@storybook/react-vite';
import AsyncIcon from '@ux/icon/async-icon.js';
import type { ReactNode } from 'react';

import { CommandPalette } from './index';
import './styles.css';
import '../../primitives/action-card/styles.css';
import '../../surfaces/bottom-sheet/styles.css';

/** The palette contents from the reference design: a search field, three quick-action
 *  cards, a Prompts group, and a Pages group with styled labels + a hotkey. */
function paletteChildren(): ReactNode {
  return (
    <>
      <CommandPalette.Search placeholder="Type a command…" aria-label="Search commands" hotkeyHint="⌘/" />
      <CommandPalette.Cards aria-label="Quick actions">
        <CommandPalette.Card id="attach" icon={<AsyncIcon icon="attachment" />} title="Attach" />
        <CommandPalette.Card id="screenshot" icon={<AsyncIcon icon="camera" />} title="Screenshot" />
        <CommandPalette.Card id="reference" icon={<AsyncIcon icon="page" />} title="Reference a file" />
      </CommandPalette.Cards>
      <CommandPalette.Group id="prompts" heading="Prompts">
        <CommandPalette.Item id="p1" icon={<AsyncIcon icon="sparkles" />}>
          Prompt 1
        </CommandPalette.Item>
        <CommandPalette.Item id="p2" icon={<AsyncIcon icon="sparkles" />}>
          Prompt 2
        </CommandPalette.Item>
        <CommandPalette.Item id="p3" icon={<AsyncIcon icon="sparkles" />}>
          Prompt 3
        </CommandPalette.Item>
      </CommandPalette.Group>
      <CommandPalette.Group id="pages" heading="Pages">
        <CommandPalette.Item id="about" icon={<AsyncIcon icon="link-arrow" />} hotkey="G A" filterText="go to /about">
          Go to <CommandPalette.Muted>/about</CommandPalette.Muted>
        </CommandPalette.Item>
        <CommandPalette.Item
          id="contact"
          icon={<AsyncIcon icon="link-arrow" />}
          hotkey="G C"
          filterText="go to /contact us"
        >
          Go to <CommandPalette.Muted>/contact us</CommandPalette.Muted>
        </CommandPalette.Item>
      </CommandPalette.Group>
    </>
  );
}

const meta: Meta<typeof CommandPalette> = {
  title: 'Input / CommandPalette',
  component: CommandPalette,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A responsive command-palette popover: an anchored **`@ux/flyout`** on desktop and a **`BottomSheet`** on mobile (< 768px). A `CommandPalette.Search` field filters **both** the `CommandPalette.Card` quick-actions and the `CommandPalette.Item` rows; empty groups and the cards row hide themselves. Keyboard follows the combobox + listbox pattern (Arrow Up/Down move the highlight, Enter activates).',
      },
    },
  },
  args: {
    trigger: { text: 'Open command palette', 'aria-label': 'Open command palette', design: 'control' },
    'aria-label': 'Commands',
    onSelect: () => {},
  },
  render: (args) => <CommandPalette {...args}>{paletteChildren()}</CommandPalette>,
};

export default meta;
type Story = StoryObj<typeof CommandPalette>;

/** Open by default on desktop so the full palette is visible for review. */
export const Default: Story = {
  args: { defaultOpen: true, isMobile: false },
};

/** Closed — only the trigger shows; click it to open the flyout. */
export const Closed: Story = {
  args: { isMobile: false },
};

/**
 * Pre-filtered with `defaultSearch="prompt"` — the cards row and the Pages group
 * hide themselves; only the matching Prompts rows remain. Edit the field to see
 * the rest reappear.
 */
export const Filtered: Story = {
  args: { defaultOpen: true, isMobile: false, defaultSearch: 'prompt' },
};

/** Empty state — a query that matches nothing shows the fallback message. */
export const NoResults: Story = {
  args: { defaultOpen: true, isMobile: false, defaultSearch: 'zzzzz' },
};

/**
 * Mobile rendering — pins `isMobile: true`; the palette opens in a chromeless
 * `BottomSheet` (no title, no X — dismiss via scrim tap or Escape).
 */
export const Mobile: Story = {
  args: { isMobile: true, defaultOpen: true },
  globals: { viewport: { value: 'iphonese2' } },
};

/**
 * Viewport-driven — no `isMobile` override, so the internal `matchMedia`
 * breakpoint chooses the flyout (≥ 768px) or the bottom sheet (< 768px). Use the
 * **Viewport** toolbar to toggle.
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'iphonese2' } },
};
