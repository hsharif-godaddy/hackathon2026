import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import { useState } from 'react';

import { PromptBox } from '../../input/prompt-box';
import { AiroHeader, PanelChrome } from '../../surfaces/panel-chrome';
import { AgentMessage } from '../agent-message';
import { UserMessage } from '../user-message';
import { ChatLayout } from './ChatLayout';
import '../../input/prompt-box/styles.css';
import '../../surfaces/panel-chrome/styles.css';
import '../agent-message/styles.css';
import '../user-message/styles.css';
import './styles.css';

const meta = {
  title: 'chat/ChatLayout',
  component: ChatLayout,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      // height: 100vh gives PanelChrome's `height: 100%` CSS a concrete parent height.
      <div style={{ height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Shared demo fixtures ─────────────────────────────────────────────────────

const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'activity', label: 'Activity' },
  { id: 'history', label: 'History' },
];

// ─── Reusable demo fragments ──────────────────────────────────────────────────

/** Conversation thread for the logo-creation scenario. */
function LogoConversation() {
  return (
    <Box orientation="vertical" gap="md" blockPadding="md" inlinePadding="lg">
      <UserMessage>I need a logo for my startup, Airo.</UserMessage>
      <AgentMessage>
        {`I'd love to help create an Airo logo. What feeling should it convey — bold and energetic, or clean and minimal?`}
      </AgentMessage>
      <UserMessage>Clean, modern, minimal. Maybe something geometric.</UserMessage>
      <AgentMessage>
        {`Perfect. I'm thinking a strong geometric letterform paired with a wordmark. Let me generate a concept.`}
      </AgentMessage>
      <AgentMessage>
        {`Here's the first concept — a bold **A** mark with wide letter-spacing on the wordmark. The geometry makes it work at any size, from favicon to billboard.`}
      </AgentMessage>
    </Box>
  );
}

/**
 * Large-format logo preview — what fills the content pane in sidebar mode.
 * Uses Box intents for surface and foreground so it respects the active theme.
 */
function LogoCanvas() {
  return (
    <Box
      elevation="base"
      inlineAlignChildren="center"
      blockAlignChildren="center"
      style={{ height: '100%' }}
    >
      <Box orientation="vertical" gap="md" inlineAlignChildren="center">
        {/* Logo mark: a bold letter A inside a square tile */}
        <Box
          highContrast
          rounding="reduced"
          inlineAlignChildren="center"
          blockAlignChildren="center"
          style={{ width: '12rem', height: '12rem' }}
        >
          <svg
            viewBox="0 0 100 100"
            width="72"
            height="72"
            aria-hidden="true"
            style={{ display: 'block' }}
          >
            <text
              x="50"
              y="78"
              textAnchor="middle"
              fontSize="90"
              fontWeight="900"
              fill="currentColor"
            >
              A
            </text>
          </svg>
        </Box>

        {/* Wordmark + caption */}
        <Box>Airo</Box>
        <Box>Logo concept · iteration 1</Box>
      </Box>
    </Box>
  );
}

// ─── Stories ──────────────────────────────────────────────────────────────────

/**
 * Default fullscreen chat — the chat column is centered at a comfortable
 * reading width with no secondary content pane.
 */
export const Centered: Story = {
  args: { children: null },
  render: () => (
    <PanelChrome
      aria-label="Airo"
      onClose={() => {}}
      style={{ height: '100%' }}
      header={
        <AiroHeader
          tabs={TABS}
          showSections={false}
          onClose={() => {}}
          onActionClick={() => {}}
          actionLabel="New conversation"
        />
      }
    >
      <ChatLayout
        header={
          <AiroHeader.Sections
            tabs={TABS}
            defaultActiveTabId="chat"
            onActionClick={() => {}}
            actionLabel="New conversation"
          />
        }
        footer={<PromptBox placeholder="Ask Airo anything…" />}
      >
        <LogoConversation />
      </ChatLayout>
    </PanelChrome>
  ),
};

/**
 * Once the logo is ready, the layout shifts to sidebar mode: the chat column
 * pins to the leading edge and the logo fills the content pane to the right.
 * The tab switcher lives inside the chat column so it tracks the chat width.
 */
export const Sidebar: Story = {
  args: { children: null },
  render: () => (
    <PanelChrome
      aria-label="Airo"
      onClose={() => {}}
      style={{ height: '100%' }}
      header={
        <AiroHeader
          tabs={TABS}
          showSections={false}
          onClose={() => {}}
          onActionClick={() => {}}
          actionLabel="New conversation"
        />
      }
    >
      <ChatLayout
        layout="sidebar"
        header={
          <AiroHeader.Sections
            tabs={TABS}
            defaultActiveTabId="chat"
            onActionClick={() => {}}
            actionLabel="New conversation"
          />
        }
        footer={<PromptBox placeholder="Ask Airo to refine the logo…" />}
        content={<LogoCanvas />}
      >
        <LogoConversation />
      </ChatLayout>
    </PanelChrome>
  ),
};

/**
 * Live toggle — click "Show logo preview" to animate from centered to sidebar.
 * The tab switcher is inside the chat column so it stays constrained to the
 * chat panel width in both modes.
 */
export const LogoCreationFlow: Story = {
  args: { children: null },
  render: () => {
    const [layout, setLayout] = useState<'centered' | 'sidebar'>('centered');
    const [activeTab, setActiveTab] = useState('chat');
    const [expanded, setExpanded] = useState(false);
    const hasSidebar = layout === 'sidebar';

    return (
      <PanelChrome
        aria-label="Airo"
        onClose={() => {}}
        style={{ height: '100%' }}
        header={
          <AiroHeader
            tabs={TABS}
            showSections={false}
            onClose={() => {}}
            onExpandedToggle={() => setExpanded((v) => !v)}
            expanded={expanded}
          />
        }
      >
        <ChatLayout
          layout={layout}
          header={
            <AiroHeader.Sections
              tabs={TABS}
              activeTabId={activeTab}
              onTabChange={setActiveTab}
              action={
                <Button
                  design="control"
                  text={hasSidebar ? 'Chat only' : 'Show logo preview'}
                  onClick={() => setLayout((l) => (l === 'centered' ? 'sidebar' : 'centered'))}
                />
              }
            />
          }
          footer={<PromptBox placeholder="Ask Airo to refine the logo…" />}
          content={hasSidebar ? <LogoCanvas /> : undefined}
        >
          <LogoConversation />
        </ChatLayout>
      </PanelChrome>
    );
  },
};

/**
 * Sidebar in RTL — the chat column should pin to the inline-start edge
 * (right side in RTL). Validates the `:dir(rtl)` CSS override.
 */
export const RTL: Story = {
  args: { children: null },
  render: () => (
    <div dir="rtl" style={{ height: '100%' }}>
      <PanelChrome
        aria-label="Airo"
        onClose={() => {}}
        style={{ height: '100%' }}
        header={
          <AiroHeader
            tabs={TABS}
            showSections={false}
            onClose={() => {}}
            onActionClick={() => {}}
            actionLabel="New conversation"
          />
        }
      >
        <ChatLayout
          layout="sidebar"
          header={
            <AiroHeader.Sections
              tabs={TABS}
              defaultActiveTabId="chat"
              onActionClick={() => {}}
              actionLabel="New conversation"
            />
          }
          footer={<PromptBox placeholder="Ask Airo to refine the logo…" />}
          content={<LogoCanvas />}
        >
          <LogoConversation />
        </ChatLayout>
      </PanelChrome>
    </div>
  ),
};
