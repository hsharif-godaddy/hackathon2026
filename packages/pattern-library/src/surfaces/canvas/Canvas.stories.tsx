import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import TextLockup from '@ux/text-lockup';
import { useState } from 'react';

import { AgentMessage } from '../../chat/agent-message';
import '../../chat/agent-message/styles.css';
import { ChatLayout } from '../../chat/chat-layout';
import '../../chat/chat-layout/styles.css';
import { UserMessage } from '../../chat/user-message';
import '../../chat/user-message/styles.css';
import { PromptBox } from '../../input/prompt-box';
import '../../input/prompt-box/styles.css';
import '../../primitives/thinking-indicator/styles.css';
import { Canvas } from './Canvas';
import './styles.css';

const meta: Meta<typeof Canvas> = {
  title: 'surfaces/Canvas',
  component: Canvas,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A `<section>` surface that hosts AI-generated content alongside the chat panel. Owns three slots — `header` (toolbar), `children` (primary content), and `status` (a floating chip pinned top-center). Compound `Canvas.Status` is a rounded themed pill with a small spinner and label, calibrated for surfacing in-progress agent actions without blocking the underlying preview.',
      },
    },
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      // height: 100vh gives the canvas a concrete parent height for stories
      // that demo it as a fullscreen surface.
      <div style={{ height: '100vh', padding: 16, boxSizing: 'border-box' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Canvas>;

// ─── Reusable demo fragments ─────────────────────────────────────────────────

/** Stable-ordered list of section titles for the scroll-fade demos. */
const SCROLL_FADE_DEMO_ROWS = Array.from({ length: 24 }, (_, i) => `Section ${i + 1}`);

/** Stand-in for a rendered AI artifact — looks like a styled preview frame. */
function PreviewPlaceholder({ heading = 'Site preview' }: { heading?: string }) {
  return (
    <Box
      orientation="vertical"
      gap="md"
      inlinePadding="lg"
      blockPadding="lg"
      inlineAlignChildren="center"
      blockAlignChildren="center"
      style={{ minHeight: '100%' }}
    >
      <TextLockup size="lg" title={heading} titleLevel={2}>
        Drop your generated HTML, an iframe, or any artifact here. The inner scroll wrapper is
        `overflow: auto`, so oversized content scrolls inside the canvas frame instead of escaping
        it. The body element is just a positioning context for the floating status chip.
      </TextLockup>
    </Box>
  );
}

/** Minimal toolbar — buttons that would live above a real preview. */
function PreviewToolbar() {
  return (
    <Box
      orientation="horizontal"
      gap="sm"
      blockAlignChildren="spaceBetween"
      inlineAlignChildren="center"
    >
      <TextLockup size="sm" title="Preview" />
      <Box displayType="flex" orientation="horizontal" gap="sm">
        <Button design="tertiary" size="small" text="Desktop" />
        <Button design="tertiary" size="small" text="Mobile" />
        <Button design="secondary" size="small" text="Refresh" />
      </Box>
    </Box>
  );
}

// ─── Stories ─────────────────────────────────────────────────────────────────

export const Default: Story = {
  args: {
    'aria-label': 'Site preview',
    children: <PreviewPlaceholder />,
  },
};

export const WithHeader: Story = {
  args: {
    'aria-label': 'Site preview',
    header: <PreviewToolbar />,
    children: <PreviewPlaceholder />,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Pass any node to `header` to render a toolbar above the content. The header has a built-in bottom divider; consumers control its inner layout.',
      },
    },
  },
};

export const WithStatus: Story = {
  args: {
    'aria-label': 'Site preview',
    header: <PreviewToolbar />,
    status: <Canvas.Status label="Editing…" />,
    children: <PreviewPlaceholder />,
  },
  parameters: {
    docs: {
      description: {
        story:
          'When the agent is mutating the canvas, pass `<Canvas.Status label="Editing…" />` to the `status` slot. The chip is anchored top-center over the content area and uses `pointer-events: none` so the underlying preview stays interactive.',
      },
    },
  },
};

export const ScrollingContent: Story = {
  args: {
    'aria-label': 'Site preview',
    header: <PreviewToolbar />,
    children: (
      <Box orientation="vertical" gap="md" inlinePadding="lg" blockPadding="lg">
        {SCROLL_FADE_DEMO_ROWS.map((title) => (
          <TextLockup key={title} size="md" title={title}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
            exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
          </TextLockup>
        ))}
      </Box>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          "When the canvas content overflows, a soft 56px gradient mask fades the top edge while the user is scrolled away from the start, and the bottom edge while they're scrolled away from the end. The header and `Canvas.Status` slots are siblings of the internal scroll wrapper, so the mask never dims them. Override the fade distance with the `--airo-surfaces-canvas-fade-distance` custom property, or set `fadeOnScroll={false}` to disable the mask entirely.",
      },
    },
  },
};

export const ScrollingContentFadeOff: Story = {
  args: {
    'aria-label': 'Site preview',
    header: <PreviewToolbar />,
    fadeOnScroll: false,
    children: (
      <Box orientation="vertical" gap="md" inlinePadding="lg" blockPadding="lg">
        {SCROLL_FADE_DEMO_ROWS.map((title) => (
          <TextLockup key={title} size="md" title={title}>
            Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua.
          </TextLockup>
        ))}
      </Box>
    ),
  },
  parameters: {
    docs: {
      description: {
        story:
          'Same overflowing content as `ScrollingContent`, but with `fadeOnScroll={false}` — the canvas presents a hard top/bottom edge instead of the gradient mask.',
      },
    },
  },
};

export const StandaloneStatus: Story = {
  render: () => (
    <Box
      orientation="horizontal"
      gap="md"
      inlinePadding="md"
      blockPadding="md"
      inlineAlignChildren="center"
      blockAlignChildren="center"
    >
      <Canvas.Status label="Editing…" />
      <Canvas.Status label="Generating preview…" />
      <Canvas.Status label="Saving draft…" />
    </Box>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "`Canvas.Status` is a flow-level pill with no built-in positioning. Use it inside `Canvas`'s `status` slot for the canvas-anchored case, or wrap it in your own positioned element for viewport-anchored chrome.",
      },
    },
  },
};

// ─── Builder playground ─────────────────────────────────────────────────────

interface ScenarioActionShape {
  label: string;
  onTrigger: () => void;
}

interface ScenarioCardShape {
  label: string;
  description: string;
  actions: ScenarioActionShape[];
}

function ScenarioCard({ label, description, actions }: ScenarioCardShape) {
  return (
    <Box orientation="vertical" gap="sm" inlinePadding="md" blockPadding="md" elevation="raised">
      <TextLockup size="sm" title={label}>
        {description}
      </TextLockup>
      <Box displayType="flex" orientation="horizontal" gap="sm">
        {actions.map((action) => (
          <Button
            key={action.label}
            design="secondary"
            size="small"
            text={action.label}
            onClick={action.onTrigger}
          />
        ))}
      </Box>
    </Box>
  );
}

function BuilderPlaygroundDemo() {
  const [editing, setEditing] = useState(false);
  const [statusLabel, setStatusLabel] = useState('Editing…');
  const [thread, setThread] = useState<Array<{ id: string; kind: 'agent' | 'user'; text: string }>>(
    [
      {
        id: 'a1',
        kind: 'agent',
        text: "Hi! I'm your Airo agent. Use the cards in the canvas on the right to inject scenarios.",
      },
    ],
  );

  const append = (kind: 'agent' | 'user', text: string) => {
    setThread((prev) => [...prev, { id: `${prev.length + 1}`, kind, text }]);
  };

  const triggerEditing = (label: string) => {
    setStatusLabel(label);
    setEditing(true);
    window.setTimeout(() => setEditing(false), 2400);
  };

  return (
    <Box orientation="horizontal" gap="md" style={{ height: '100%', minHeight: 0 }}>
      <Box style={{ flex: '0 0 360px', minHeight: 0, height: '100%' }}>
        <ChatLayout
          layout="centered"
          footer={<PromptBox placeholder="Reply to the agent…" disabled />}
        >
          <Box orientation="vertical" gap="md" blockPadding="md" inlinePadding="lg">
            {thread.map((m) =>
              m.kind === 'agent' ? (
                <AgentMessage key={m.id}>{m.text}</AgentMessage>
              ) : (
                <UserMessage key={m.id}>{m.text}</UserMessage>
              ),
            )}
          </Box>
        </ChatLayout>
      </Box>
      <Box style={{ flex: '1 1 auto', minHeight: 0, height: '100%' }}>
        <Canvas
          aria-label="Site preview"
          header={<PreviewToolbar />}
          status={editing ? <Canvas.Status label={statusLabel} /> : null}
        >
          <Box orientation="vertical" gap="md" inlinePadding="lg" blockPadding="lg">
            <TextLockup size="md" title="Scenario palette" titleLevel={2}>
              Click a card to inject a scenario into the chat panel and trigger a short-lived
              `Canvas.Status` chip.
            </TextLockup>
            <Box orientation="vertical" gap="md">
              <ScenarioCard
                label="Edit hero copy"
                description="Send a user message and show the editing chip while the agent applies the change."
                actions={[
                  {
                    label: 'Run',
                    onTrigger: () => {
                      append('user', 'Make the hero copy punchier.');
                      triggerEditing('Editing…');
                      window.setTimeout(
                        () => append('agent', 'Done. Tightened the hero copy and bolded the CTA.'),
                        2600,
                      );
                    },
                  },
                ]}
              />
              <ScenarioCard
                label="Generate preview"
                description="Simulate a longer-running build with a different status label."
                actions={[
                  {
                    label: 'Run',
                    onTrigger: () => {
                      append('user', 'Regenerate the preview from scratch.');
                      triggerEditing('Generating preview…');
                      window.setTimeout(
                        () =>
                          append('agent', 'Preview rebuilt. Layout is now a single-column hero.'),
                        2600,
                      );
                    },
                  },
                ]}
              />
              <ScenarioCard
                label="Save draft"
                description="Short save action that flashes the chip briefly."
                actions={[
                  {
                    label: 'Run',
                    onTrigger: () => {
                      triggerEditing('Saving draft…');
                    },
                  },
                ]}
              />
            </Box>
          </Box>
        </Canvas>
      </Box>
    </Box>
  );
}

export const BuilderPlayground: Story = {
  render: () => <BuilderPlaygroundDemo />,
  parameters: {
    docs: {
      description: {
        story:
          'Dual-pane layout: `ChatLayout` on the left, `Canvas` on the right with a scenario palette inside. Click a card to inject a message into the chat panel and flash the `Canvas.Status` chip — the canvas hosts both the rendered artifact (or a stand-in palette here) and any in-flight status chrome.',
      },
    },
  },
};
