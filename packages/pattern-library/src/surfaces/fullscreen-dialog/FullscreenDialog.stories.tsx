import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import TextLockup from '@ux/text-lockup';
import { useState } from 'react';

import { PromptBox } from '../../input/prompt-box';
import { AiroHeader } from '../panel-chrome';
import { FullscreenDialog } from './index';
import '../../input/prompt-box/styles.css';
import './styles.css';
import '../panel-chrome/styles.css';

/**
 * `FullscreenDialog` is a full-viewport modal surface backed by `@ux/disrupt`
 * (scrim, focus trap, Escape-to-close). It always covers the entire screen —
 * edge-to-edge, no margins, no border-radius.
 *
 * Click **"Open dialog"** in each story to trigger it.
 */
const meta: Meta<typeof FullscreenDialog> = {
  title: 'Surfaces / FullscreenDialog',
  component: FullscreenDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Full-viewport modal surface that always covers the entire screen — edge-to-edge, no margins, no border-radius. Backed by `@ux/disrupt` (scrim, focus trap, Escape). Composes `PanelChrome` for the inner UI (header, scrollable content, sticky footer).',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof FullscreenDialog>;

// ─── Helpers ─────────────────────────────────────────────────────────────

function Launcher({ children }: { children: React.ReactNode }) {
  return (
    <Box inlinePadding="xl" blockPadding="xl">
      <TextLockup title="Page content behind the dialog" />
      <TextLockup>Open the dialog to see the full-viewport scrim and focus trap.</TextLockup>
      {children}
    </Box>
  );
}

// ─── Default ─────────────────────────────────────────────────────────────

export const Default: Story = {
  name: 'Default (full-viewport)',
  render: () => <DefaultDemo />,
};

function DefaultDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Launcher>
      <Button design="secondary" text="Open dialog" onClick={() => setOpen(true)} />
      <FullscreenDialog
        show={open}
        onClose={() => setOpen(false)}
        title="Settings"
        footer={
          <Box orientation="horizontal" gap="sm" inlineAlignChildren="end">
            <Button design="secondary" text="Cancel" onClick={() => setOpen(false)} />
            <Button design="primary" text="Save" />
          </Box>
        }
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>
            Full-viewport dialog — edge-to-edge, no margins. Focus is trapped inside; Escape or the
            close button dismisses it.
          </TextLockup>
        </Box>
      </FullscreenDialog>
    </Launcher>
  );
}

// ─── Scrollable content ───────────────────────────────────────────────────

export const ScrollableContent: Story = {
  name: 'Scrollable content (sticky header)',
  render: () => <ScrollDemo />,
};

function ScrollDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Launcher>
      <Button design="secondary" text="Open dialog" onClick={() => setOpen(true)} />
      <FullscreenDialog show={open} onClose={() => setOpen(false)} title="Long content">
        <Box inlinePadding="lg" blockPadding="md">
          {Array.from({ length: 40 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: demo content
            <TextLockup key={i}>
              Paragraph {i + 1}. Scroll down and the header slides out of view; scroll back up to
              reveal it.
            </TextLockup>
          ))}
        </Box>
      </FullscreenDialog>
    </Launcher>
  );
}

// ─── With AiroHeader ─────────────────────────────────────────────────────

export const WithAiroHeader: Story = {
  name: 'With AiroHeader',
  render: () => <AiroHeaderDemo />,
};

function AiroHeaderDemo() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');

  const content: Record<string, string> = {
    chat: 'Chat section — conversation content lives here.',
    activity: 'Activity section — recent automations or tool calls.',
  };

  return (
    <Launcher>
      <Button design="secondary" text="Open dialog" onClick={() => setOpen(true)} />
      <FullscreenDialog
        show={open}
        onClose={() => setOpen(false)}
        aria-label="Airo"
        header={
          <AiroHeader
            tabs={[
              { id: 'chat', label: 'Chat' },
              { id: 'activity', label: 'Activity' },
            ]}
            activeTabId={activeTab}
            onTabChange={setActiveTab}
            onActionClick={() => {}}
            actionLabel="New conversation"
            onClose={() => setOpen(false)}
          />
        }
        footer={<PromptBox placeholder="Type a message…" />}
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>{content[activeTab]}</TextLockup>
        </Box>
      </FullscreenDialog>
    </Launcher>
  );
}
