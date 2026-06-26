import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';
import { useState } from 'react';

import { ResponsivePopover } from './index';
import './styles.css';
import '../bottom-sheet/styles.css';

const meta: Meta<typeof ResponsivePopover> = {
  title: 'Surfaces / ResponsivePopover',
  component: ResponsivePopover,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Rich popover content that adapts to viewport size: an anchored **`@ux/flyout`** popover on desktop, and a **`BottomSheet`** on mobile (< 640px). The same `children` render in both surfaces. Content-agnostic sibling of **`ResponsiveMenu`**. Controlled-or-uncontrolled; `onOpenChange` reports the next desired state for every dismissal path (trigger, outside-click, Escape, scrim tap, sheet X).',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof ResponsivePopover>;

/** Example popover body — the same markup renders in the flyout and the sheet. */
function PublishBody() {
  return (
    <Box orientation="vertical" blockPadding="lg" inlinePadding="lg" gap="md">
      <text.p size={-1}>Your changes will go live at example.com.</text.p>
      <Button design="primary" size="sm" text="Publish now" stretch />
    </Box>
  );
}

/**
 * Controlled. Resize the preview across 640px to swap between the desktop
 * flyout and the mobile bottom sheet.
 */
export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 'var(--ux-box-density)', display: 'flex', justifyContent: 'flex-end' }}>
        <ResponsivePopover
          open={open}
          onOpenChange={setOpen}
          sheetTitle="Publish"
          placement="bottom-end"
          popoverClassName="gdai-cmp-w-[320px]"
          renderTrigger={(tp) => (
            <Button
              design="primary"
              text="Publish"
              aria-haspopup={tp['aria-haspopup']}
              aria-expanded={tp['aria-expanded']}
              onClick={tp.onClick}
            />
          )}
        >
          <PublishBody />
        </ResponsivePopover>
      </div>
    );
  },
};

/** Forced desktop rendering — anchored `@ux/flyout` popover regardless of viewport. */
export const Desktop: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 'var(--ux-box-density)', display: 'flex', justifyContent: 'flex-end' }}>
        <ResponsivePopover
          isMobile={false}
          open={open}
          onOpenChange={setOpen}
          sheetTitle="Publish"
          popoverClassName="gdai-cmp-w-[320px]"
          renderTrigger={(tp) => (
            <Button
              design="primary"
              text="Publish (desktop)"
              aria-haspopup={tp['aria-haspopup']}
              aria-expanded={tp['aria-expanded']}
              onClick={tp.onClick}
            />
          )}
        >
          <PublishBody />
        </ResponsivePopover>
      </div>
    );
  },
};

/** Forced mobile rendering — `BottomSheet` regardless of viewport. */
export const Mobile: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 'var(--ux-box-density)' }}>
        <ResponsivePopover
          isMobile
          open={open}
          onOpenChange={setOpen}
          sheetTitle="Publish"
          renderTrigger={(tp) => (
            <Button
              design="primary"
              text="Publish (mobile)"
              aria-haspopup={tp['aria-haspopup']}
              aria-expanded={tp['aria-expanded']}
              onClick={tp.onClick}
            />
          )}
        >
          <PublishBody />
        </ResponsivePopover>
      </div>
    );
  },
};

/** Uncontrolled — the component owns open state; trigger toggles it. */
export const Uncontrolled: Story = {
  render: () => (
    <div style={{ padding: 'var(--ux-box-density)', display: 'flex', justifyContent: 'flex-end' }}>
      <ResponsivePopover
        sheetTitle="Details"
        popoverClassName="gdai-cmp-w-[320px]"
        renderTrigger={(tp) => (
          <Button
            design="secondary"
            text="Details"
            aria-haspopup={tp['aria-haspopup']}
            aria-expanded={tp['aria-expanded']}
            onClick={tp.onClick}
          />
        )}
      >
        <PublishBody />
      </ResponsivePopover>
    </div>
  ),
};
