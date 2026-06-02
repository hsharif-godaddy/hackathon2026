import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import TextLockup from '@ux/text-lockup';
import { useState } from 'react';

import { PromptBox } from '../../input/prompt-box';
import '../../input/prompt-box/styles.css';
import { FloatingFooter } from '../floating-footer';
import '../floating-footer/styles.css';
import { AiroHeader, PanelChrome } from './index';
import './styles.css';

/**
 * `PanelChrome` is rendered standalone in these stories — surfaces compose
 * it inside a portal/host plus their own positioning and animation. The
 * stories show the chrome in a fixed-size frame so its sticky header,
 * scrollable body, and sticky footer animations are visible without a
 * surface around them.
 */
const meta: Meta<typeof PanelChrome> = {
  title: 'Surfaces / PanelChrome',
  component: PanelChrome,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Shared inner UI for every Airo surface. Owns the header band, scrollable content, sticky footer, and dialog/complementary landmark semantics — surfaces add the host (Disrupt portal, plain portal, edge positioning, draggable window, …) and the outer animation.',
      },
    },
  },
  argTypes: {
    stickyHeader: { control: 'boolean' },
    hideFooter: { control: 'boolean' },
    modal: { control: 'boolean' },
    title: { control: 'text' },
    closeLabel: { control: 'text' },
    expandLabel: { control: 'text' },
    collapseLabel: { control: 'text' },
  },
};

export default meta;

type Story = StoryObj<typeof PanelChrome>;

/** Canonical dimensions for all story frames. */
const FRAME_W = 384;
const FRAME_H = 560;

/**
 * Renders the chrome inside a fixed-size frame so the inner sticky-footer
 * and hide-on-scroll-down behaviors are visible without a surrounding
 * surface. Surfaces in production replace this frame with their own
 * positioning + host (portal, Disrupt, etc.).
 *
 * Uses `@ux/box` with the `elevation` token for surface depth — both
 * intent-bound — so the frame doesn't introduce hardcoded colors. Only the
 * fixed width/height live as inline styles.
 *
 * `position: relative` on the Box + `position: absolute; inset: 0` on the
 * inner div creates a containing block with a concrete pixel size. Each
 * story then passes `style={{ height: '100%' }}` to PanelChrome, which is
 * exactly what surface wrappers do in production (e.g.
 * `.airo-surfaces-floating-panel__chrome { height: 100% }`). Without an
 * explicit height on PanelChrome the flex content region has no finite
 * ceiling to scroll against.
 */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <Box
      elevation="raised"
      style={{ width: FRAME_W, height: FRAME_H, overflow: 'hidden', position: 'relative' }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>{children}</div>
    </Box>
  );
}

export const Default: Story = {
  args: {
    title: 'Panel chrome',
    onClose: () => {},
  },
  render: (args) => (
    <Frame>
      <PanelChrome {...args} style={{ height: '100%' }}>
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>
            The chrome owns the header band, scrollable body, and sticky footer.
          </TextLockup>
          <TextLockup>Hover the corner actions to see the expand and close affordances.</TextLockup>
        </Box>
      </PanelChrome>
    </Frame>
  ),
};

export const WithFooter: Story = {
  args: {
    title: 'Conversation',
    onClose: () => {},
  },
  render: (args) => (
    <Frame>
      <PanelChrome
        {...args}
        style={{ height: '100%' }}
        footer={<PromptBox placeholder="Type a message…" />}
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>Typical chat layout — header, scrollable body, sticky composer.</TextLockup>
        </Box>
      </PanelChrome>
    </Frame>
  ),
};

/**
 * `footerChrome="floating"` — transparent footer band, no footer shadow, no top
 * padding; **`lg`** horizontal inset and **`md`** bottom inset. Pairs with **`FloatingFooter`** +
 * borderless **`PromptBox`** (see **Examples / Chat Panel → Fixed conversation
 * (floating composer)**).
 */
export const WithFloatingFooterChrome: Story = {
  name: 'Floating footer chrome',
  args: {
    title: 'Composer in gutter',
    onClose: () => {},
  },
  render: (args) => (
    <Frame>
      <PanelChrome
        {...args}
        style={{ height: '100%' }}
        footerChrome="floating"
        footer={
          <FloatingFooter>
            <PromptBox appearance="borderless" placeholder="Message…" onSubmit={() => {}} />
          </FloatingFooter>
        }
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>
            The footer chrome gutter is transparent so <strong>FloatingFooter</strong> supplies
            raised depth; horizontal inset matches <strong>lg</strong> and bottom inset{' '}
            <strong>md</strong>, with no inset above the capsule.
          </TextLockup>
        </Box>
      </PanelChrome>
    </Frame>
  ),
};

export const ScrollableContent: Story = {
  name: 'Scrollable content (hide-on-scroll-down header)',
  args: {
    title: 'Scroll me',
    onClose: () => {},
  },
  render: (args) => (
    <Frame>
      <PanelChrome {...args} style={{ height: '100%' }}>
        <Box inlinePadding="lg" blockPadding="md">
          {Array.from({ length: 50 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: demo content
            <TextLockup key={i}>
              Paragraph {i + 1}. Scroll down and the header slides out of view; scroll up to bring
              it back instantly.
            </TextLockup>
          ))}
        </Box>
      </PanelChrome>
    </Frame>
  ),
};

export const HideFooterToggle: Story = {
  name: 'Footer toggle (hideFooter)',
  render: (args) => <HideFooterDemo {...args} />,
};

function HideFooterDemo(args: React.ComponentProps<typeof PanelChrome>) {
  const [hideFooter, setHideFooter] = useState(false);
  return (
    <Frame>
      <PanelChrome
        {...args}
        title="Toggle the footer"
        onClose={() => {}}
        hideFooter={hideFooter}
        style={{ height: '100%' }}
        footer={<div>Footer content — toggle me.</div>}
      >
        <Box inlinePadding="lg" blockPadding="md">
          <Button
            design="secondary"
            text={hideFooter ? 'Show footer' : 'Hide footer'}
            onClick={() => setHideFooter((v) => !v)}
          />
          <TextLockup>
            Footer slides in from the chrome's bottom edge when shown and slides out when hidden.
          </TextLockup>
        </Box>
      </PanelChrome>
    </Frame>
  );
}

export const NonModal: Story = {
  name: 'Non-modal (role=complementary)',
  args: {
    title: 'Inspector',
    onClose: () => {},
    modal: false,
  },
  render: (args) => (
    <Frame>
      <PanelChrome {...args} style={{ height: '100%' }}>
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>
            With `modal={false}`, the root carries `role="complementary"`, the chrome listens for
            Escape itself, and previous focus is restored on unmount.
          </TextLockup>
        </Box>
      </PanelChrome>
    </Frame>
  ),
};

export const Modal: Story = {
  name: 'Modal (role=dialog)',
  args: {
    title: 'Settings',
    onClose: () => {},
    modal: true,
  },
  render: (args) => (
    <Frame>
      <PanelChrome {...args} style={{ height: '100%' }}>
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>
            With `modal={true}`, the root carries `role="dialog"` and `aria-modal="true"`. Escape
            and focus-restore are deferred to the surface's modal host (e.g. `@ux/disrupt`).
          </TextLockup>
        </Box>
      </PanelChrome>
    </Frame>
  ),
};

export const WithAiroHeader: Story = {
  name: 'With AiroHeader',
  render: (args) => <AiroHeaderDemo {...args} />,
};

function AiroHeaderDemo(args: React.ComponentProps<typeof PanelChrome>) {
  const [activeTab, setActiveTab] = useState('chat');
  const [expanded, setExpanded] = useState(false);

  const tabs = [
    { id: 'chat', label: 'Chat' },
    { id: 'activity', label: 'Activity' },
    { id: 'history', label: 'History' },
  ];

  const content = {
    chat: 'Chat section — conversation content lives here.',
    activity: 'Activity section — recent automations or tool calls.',
    history: 'History section — past conversations.',
  } as const;

  return (
    <Frame>
      <PanelChrome
        {...args}
        aria-label="Airo"
        onClose={() => {}}
        style={{ height: '100%' }}
        header={
          <AiroHeader
            tabs={tabs}
            activeTabId={activeTab}
            onTabChange={setActiveTab}
            onActionClick={() => {}}
            actionLabel="New conversation"
            onClose={() => {}}
            onExpandedToggle={() => setExpanded((v) => !v)}
            expanded={expanded}
          />
        }
      >
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>{content[activeTab as keyof typeof content]}</TextLockup>
        </Box>
      </PanelChrome>
    </Frame>
  );
}
