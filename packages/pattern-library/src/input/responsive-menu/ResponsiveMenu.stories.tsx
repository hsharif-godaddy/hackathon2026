import type { Meta, StoryObj } from '@storybook/react-vite';
import AsyncIcon from '@ux/icon/async-icon.js';

import { ResponsiveMenu, type ResponsiveMenuItem } from './index';
import './styles.css';
import '../../surfaces/bottom-sheet/styles.css';

const items: ResponsiveMenuItem[] = [
  { id: 'edit', label: 'Edit', icon: <AsyncIcon icon="edit" />, href: '#edit' },
  { id: 'rename', label: 'Rename', icon: <AsyncIcon icon="text-tool" />, onClick: () => {} },
  { id: 'settings', label: 'Settings', icon: <AsyncIcon icon="settings" />, href: '#settings' },
  {
    id: 'delete',
    label: 'Delete',
    icon: <AsyncIcon icon="trash" />,
    emphasis: 'critical',
    separatorBefore: true,
    onClick: () => {},
  },
];

const meta: Meta<typeof ResponsiveMenu> = {
  title: 'Input / ResponsiveMenu',
  component: ResponsiveMenu,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'An action menu that adapts to viewport size: an anchored **`@ux/menu`** flyout on desktop, and a **`BottomSheet`** action list on mobile (< 640px). Both surfaces are driven by the same `items` array, so links, destructive styling, disabled state, separators, and `data-*` instrumentation stay in sync. The `isMobile` prop forces a rendering (defaults to an internal `matchMedia` breakpoint).',
      },
    },
  },
  args: {
    trigger: {
      icon: <AsyncIcon icon="ellipsis" />,
      design: 'control',
      size: 'sm',
      'aria-label': 'Actions',
    },
    sheetTitle: 'Actions',
    items,
  },
};

export default meta;

type Story = StoryObj<typeof ResponsiveMenu>;

/**
 * Viewport-driven — no `isMobile` override, so the component uses its internal
 * `matchMedia` breakpoint and the desktop flyout / mobile sheet is chosen by the
 * story iframe's width. Defaults to iPhone SE here; use the **Viewport** toolbar
 * to toggle — ≥ 640px shows the flyout, < 640px shows the bottom sheet. (Chrome
 * DevTools device mode resizes the page, not the iframe, so use the toolbar.)
 */
export const Responsive: Story = {
  globals: { viewport: { value: 'iphonese2' } },
};

/** Desktop rendering — pins `isMobile: false` (anchored `@ux/menu` flyout). See **Responsive** for viewport-driven switching. */
export const Desktop: Story = {
  args: { isMobile: false },
};

/** Mobile rendering — pins `isMobile: true`; tap the trigger to open the bottom sheet. See **Responsive** for viewport-driven switching. */
export const Mobile: Story = {
  args: { isMobile: true },
};

/**
 * Labelled trigger instead of an icon-only kebab. Viewport-driven (no `isMobile`
 * override) — defaults to iPhone SE so it opens as a sheet; use the **Viewport**
 * toolbar to switch the text trigger between the desktop flyout and the sheet.
 */
export const TextTrigger: Story = {
  globals: { viewport: { value: 'iphonese2' } },
  args: {
    trigger: { text: 'Export', design: 'secondary', size: 'sm' },
    sheetTitle: 'Export',
    items: [
      { id: 'csv', label: 'Export as CSV', onClick: () => {} },
      { id: 'json', label: 'Export as JSON', onClick: () => {} },
    ],
  },
};

/**
 * Mixed icons — when only some items define an icon, the icon-less rows reserve
 * the leading icon space so every label aligns. Tap the trigger to open the
 * sheet.
 */
export const MixedIcons: Story = {
  args: {
    isMobile: true,
    items: [
      { id: 'edit', label: 'Edit', icon: <AsyncIcon icon="edit" />, onClick: () => {} },
      { id: 'rename', label: 'Rename', onClick: () => {} },
      { id: 'settings', label: 'Settings', onClick: () => {} },
      {
        id: 'delete',
        label: 'Delete',
        icon: <AsyncIcon icon="trash" />,
        emphasis: 'critical',
        separatorBefore: true,
        onClick: () => {},
      },
    ],
  },
};
