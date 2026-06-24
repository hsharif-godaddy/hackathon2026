import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import { useState } from 'react';

import { BottomSheet } from './index';
import './styles.css';

const meta: Meta<typeof BottomSheet> = {
  title: 'Surfaces / BottomSheet',
  component: BottomSheet,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Mobile overlay surface anchored to the viewport bottom edge, built on **`@ux/disrupt`** (scrim + focus-lock + portal). Slides up with rounded top corners and a title bar with a corner dismiss (X); closes on the X, scrim tap, or Escape. Presentational — open/close state lives in the consumer. Used as the mobile rendering of **`ResponsiveMenu`**, or directly for any bottom-anchored sheet content.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof BottomSheet>;

/** Controlled open/close driven by consumer state. */
export const Default: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 'var(--ux-box-density)' }}>
        <Button design="primary" text="Open sheet" onClick={() => setOpen(true)} />
        <BottomSheet show={open} onClose={() => setOpen(false)} title="Sheet title">
          <Box inlinePadding="lg">
            <p>Body content scrolls inside the sheet when it grows past 85% of the viewport.</p>
          </Box>
        </BottomSheet>
      </div>
    );
  },
};

/** Uncontrolled, open on mount, with no title — the corner dismiss (X) still shows. */
export const NoTitle: Story = {
  render: () => (
    <BottomSheet defaultShow aria-label="Untitled sheet">
      <Box inlinePadding="lg">
        <p>No title — the corner X dismiss is always present.</p>
      </Box>
    </BottomSheet>
  ),
};

/** A long action list demonstrating the internal scroll + max-height cap. */
export const LongContent: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <div style={{ padding: 'var(--ux-box-density)' }}>
        <Button design="primary" text="Open long sheet" onClick={() => setOpen(true)} />
        <BottomSheet show={open} onClose={() => setOpen(false)} title="Pick a device">
          <Box inlinePadding="lg">
            {Array.from({ length: 30 }, (_, i) => (
              <p key={i}>Row {i + 1}</p>
            ))}
          </Box>
        </BottomSheet>
      </div>
    );
  },
};
