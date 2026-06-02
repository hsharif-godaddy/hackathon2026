import type { Meta, StoryObj } from '@storybook/react-vite';
import Box, { box } from '@ux/box';
import text from '@ux/text';

import { DragHandle } from './DragHandle';
import './styles.css';

const meta: Meta<typeof DragHandle> = {
  title: 'Primitives / DragHandle',
  component: DragHandle,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Decorative pill that signals a draggable / resizable surface. Always `aria-hidden`; the wrapping container owns interactivity. Hover the demo containers below to see the opacity transition.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof DragHandle>;

/**
 * Horizontal pill — the variant used in panel header drag affordances.
 * The wrapping container is a `<button>` (not a div with `role="button"`)
 * so keyboard activation, focus rings, and disabled-state semantics come
 * for free.
 */
export const Horizontal: Story = {
  render: () => (
    <Box orientation="vertical" gap="lg" blockPadding="lg" inlinePadding="lg">
      <text.p>Hover the panel header pill below to see it brighten:</text.p>
      <box.button
        type="button"
        elevation="raised"
        orientation="horizontal"
        displayType="flex"
        inlineAlignChildren="center"
        blockAlignChildren="start"
        blockPadding="sm"
        inlinePadding="md"
        className="airo-primitives-drag-handle__parent"
        aria-label="Drag to reposition"
      >
        <DragHandle orientation="horizontal" />
      </box.button>
    </Box>
  ),
};

/**
 * Vertical grip — used on the inner edge of a resizable container.
 *
 * The wrapper's `inlineSize` / `blockSize` are raw `rem` literals
 * because UXCore2 has no intent token for "edge-resize-handle width" —
 * sibling `FloatingPanel.tsx` uses the same `0.75rem` × `8rem`
 * geometry internally for the same reason. Rendering this in a story
 * is the closest the docs get to teaching the carve-out, so the
 * literal stays here intentionally.
 */
export const Vertical: Story = {
  render: () => (
    <Box orientation="vertical" gap="lg" blockPadding="lg" inlinePadding="lg">
      <text.p>Hover the resize edge below to see the grip brighten:</text.p>
      <box.button
        type="button"
        elevation="raised"
        orientation="horizontal"
        displayType="flex"
        inlineAlignChildren="center"
        blockAlignChildren="center"
        className="airo-primitives-drag-handle__parent"
        aria-label="Resize"
        style={{ inlineSize: '0.75rem', blockSize: '8rem', cursor: 'col-resize' }}
      >
        <DragHandle orientation="vertical" />
      </box.button>
    </Box>
  ),
};
