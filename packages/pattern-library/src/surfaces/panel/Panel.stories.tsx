import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import TextLockup from '@ux/text-lockup';
import { useEffect, useState } from 'react';

import { PromptBox } from '../../input/prompt-box';
import { Panel } from './index';
import '../../input/prompt-box/styles.css';
import './styles.css';

const meta: Meta<typeof Panel> = {
  title: 'Surfaces / Panel',
  component: Panel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Edge-attached overlay surface built on `@ux/disrupt`. Slides in from the viewport trailing edge (right in LTR, left in RTL) while an optional scrim fades in. Exposes sticky header, scrollable content, and animated sticky footer slots.',
      },
    },
  },
  argTypes: {
    show: { control: 'boolean' },
    showDisrupt: { control: 'boolean' },
    stickyHeader: { control: 'boolean' },
    hideFooter: { control: 'boolean' },
    expanded: { control: 'boolean' },
    title: { control: 'text' },
    closeLabel: { control: 'text' },
    expandLabel: { control: 'text' },
    collapseLabel: { control: 'text' },
  },
};

export default meta;

type Story = StoryObj<typeof Panel>;

function Trigger({
  children,
  label = 'Open panel',
  initialShow = false,
}: {
  children: (args: { show: boolean; onClose: () => void }) => React.ReactNode;
  label?: string;
  initialShow?: boolean;
}) {
  const [show, setShow] = useState(initialShow);
  return (
    <Box inlinePadding="lg" blockPadding="lg">
      <Button design="primary" text={label} onClick={() => setShow(true)} />
      {children({ show, onClose: () => setShow(false) })}
    </Box>
  );
}

/** True when rendered in an individual story canvas, false on the autodocs
 *  page. Used to auto-open the panel on story pages without auto-opening
 *  every preview on the docs page (which would stack scrims and block the
 *  trigger buttons). */
const autoOpenInStoryView = (context: { viewMode?: string }) => context.viewMode === 'story';

export const Default: Story = {
  render: (args, context) => (
    <Trigger initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => (
        <Panel {...args} show={show} onClose={onClose} title="Panel title">
          <Box inlinePadding="lg" blockPadding="md">
            <TextLockup>This is the scrollable body of the panel.</TextLockup>
            <TextLockup>
              Click the close button, press Escape, or click the scrim to dismiss.
            </TextLockup>
          </Box>
        </Panel>
      )}
    </Trigger>
  ),
};

export const WithoutScrim: Story = {
  name: 'Without scrim (non-modal)',
  render: (args, context) => (
    <Trigger label="Open panel" initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => (
        <Panel {...args} show={show} onClose={onClose} showDisrupt={false} title="Inspector">
          <Box inlinePadding="lg" blockPadding="md">
            <TextLockup>
              This panel renders through a plain portal — no scrim, no focus-trap, no
              click-outside-to-dismiss. Escape still closes it.
            </TextLockup>
          </Box>
        </Panel>
      )}
    </Trigger>
  ),
};

export const CustomHeader: Story = {
  render: (args, context) => (
    <Trigger initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => (
        <Panel
          aria-label="Panel"
          {...args}
          show={show}
          onClose={onClose}
          header={
            <Box
              className="bg-canvas-subtle"
              style={{ display: 'flex', alignItems: 'center' }}
              inlinePadding="sm"
              blockPadding="sm"
            >
              <TextLockup>Custom header</TextLockup>
              <Box style={{ marginInlineStart: 'auto' }}>
                <Button design="secondary" size="small" text="Close" onClick={onClose} />
              </Box>
            </Box>
          }
        >
          <Box inlinePadding="lg" blockPadding="md">
            <TextLockup>
              The header slot is a ReactNode — replace it wholesale when the default layout doesn't
              fit.
            </TextLockup>
          </Box>
        </Panel>
      )}
    </Trigger>
  ),
};

export const WithFooter: Story = {
  render: (args, context) => (
    <Trigger initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => (
        <Panel
          {...args}
          show={show}
          onClose={onClose}
          title="Conversation"
          footer={<PromptBox placeholder="Type a message…" />}
        >
          <Box inlinePadding="lg" blockPadding="md">
            <TextLockup>Typical chat layout with a sticky composer footer.</TextLockup>
          </Box>
        </Panel>
      )}
    </Trigger>
  ),
};

export const NoFooter: Story = {
  render: (args, context) => (
    <Trigger initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => (
        <Panel {...args} show={show} onClose={onClose} title="No footer">
          <Box inlinePadding="lg" blockPadding="md">
            <TextLockup>When the `footer` prop is nullish the region is never rendered.</TextLockup>
          </Box>
        </Panel>
      )}
    </Trigger>
  ),
};

export const HiddenFooter: Story = {
  name: 'Footer toggle (hideFooter)',
  render: (args, context) => (
    <HiddenFooterDemo {...args} initialShow={autoOpenInStoryView(context)} />
  ),
};

function HiddenFooterDemo({
  initialShow = false,
  ...args
}: React.ComponentProps<typeof Panel> & { initialShow?: boolean }) {
  const [show, setShow] = useState(initialShow);
  const [hideFooter, setHideFooter] = useState(false);
  return (
    <Box blockPadding="lg" inlinePadding="lg">
      <Button design="primary" text="Open panel" onClick={() => setShow(true)} />
      <Panel
        {...args}
        show={show}
        onClose={() => setShow(false)}
        title="Toggle the footer"
        hideFooter={hideFooter}
        footer={<div>Footer content — toggle me.</div>}
      >
        <Box inlinePadding="lg" blockPadding="md">
          <Button
            design="secondary"
            text={hideFooter ? 'Show footer' : 'Hide footer'}
            onClick={() => setHideFooter((v) => !v)}
          />
          <TextLockup>
            Footer slides in from the viewport bottom when shown and slides out when hidden.
          </TextLockup>
        </Box>
      </Panel>
    </Box>
  );
}

export const ScrollableContent: Story = {
  name: 'Scrollable content (hide-on-scroll-down header)',
  render: (args, context) => (
    <Trigger initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => (
        <Panel {...args} show={show} onClose={onClose} title="Scroll me">
          <Box inlinePadding="lg" blockPadding="md">
            {Array.from({ length: 50 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: demo content
              <TextLockup key={i}>
                Paragraph {i + 1}. Scroll down and the header slides out of view; scroll up to bring
                it back instantly.
              </TextLockup>
            ))}
          </Box>
        </Panel>
      )}
    </Trigger>
  ),
};

export const StickyHeaderOff: Story = {
  name: 'Sticky header disabled',
  render: (args, context) => (
    <Trigger initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => (
        <Panel {...args} show={show} onClose={onClose} stickyHeader={false} title="Pinned header">
          <Box inlinePadding="lg" blockPadding="md">
            {Array.from({ length: 40 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: demo content
              <TextLockup key={i}>
                Paragraph {i + 1}. With `stickyHeader={false}`, the header stays visible and never
                translates out of view.
              </TextLockup>
            ))}
          </Box>
        </Panel>
      )}
    </Trigger>
  ),
};

export const Expandable: Story = {
  name: 'Expandable (full screen)',
  render: (args, context) => (
    <Trigger initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => (
        <Panel {...args} show={show} onClose={onClose} title="Expandable panel">
          <Box inlinePadding="lg" blockPadding="md">
            <TextLockup>
              Click the expand button in the corner actions to fill the viewport. Click the collapse
              button to return to the default size.
            </TextLockup>
          </Box>
        </Panel>
      )}
    </Trigger>
  ),
};

export const WithAiroHeader: Story = {
  name: 'With Airo header (segmented control)',
  render: (args, context) => (
    <Trigger label="Open Airo panel" initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => <AiroHeaderDemo show={show} onClose={onClose} {...args} />}
    </Trigger>
  ),
};

function AiroHeaderDemo({
  show,
  onClose,
  ...args
}: React.ComponentProps<typeof Panel> & { show: boolean; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState('chat');
  const [expanded, setExpanded] = useState(false);
  const [conversationCount, setConversationCount] = useState(1);

  const tabs = [
    { id: 'chat', label: 'Chat' },
    { id: 'activity', label: 'Activity' },
    { id: 'history', label: 'History' },
  ];

  const content = {
    chat: `Chat section — conversation #${conversationCount}. Click the plus button in the header to start a new conversation.`,
    activity: 'Activity section — recent automations, tool calls, or checkpoints.',
    history: 'History section — past conversations.',
  } as const;

  return (
    <Panel
      aria-label="Airo"
      {...args}
      show={show}
      onClose={onClose}
      expanded={expanded}
      onExpandedChange={setExpanded}
      header={
        <Panel.AiroHeader
          tabs={tabs}
          activeTabId={activeTab}
          onTabChange={setActiveTab}
          onActionClick={() => setConversationCount((n) => n + 1)}
          actionLabel="New conversation"
          onClose={onClose}
          onExpandedToggle={() => setExpanded((v) => !v)}
          expanded={expanded}
        />
      }
    >
      <Box inlinePadding="lg" blockPadding="md">
        <TextLockup>{content[activeTab as keyof typeof content]}</TextLockup>
        <TextLockup>
          The AiroHeader only owns the header UI — the Panel body is swapped by the parent based on
          `activeTabId`, which keeps the Panel primitive agnostic of its content.
        </TextLockup>
      </Box>
    </Panel>
  );
}

export const WithAiroHeaderNoAction: Story = {
  name: 'With Airo header (no action)',
  render: (args, context) => (
    <Trigger label="Open Airo panel" initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => (
        <Panel
          aria-label="Airo"
          {...args}
          show={show}
          onClose={onClose}
          header={
            <Panel.AiroHeader
              tabs={[
                { id: 'chat', label: 'Chat' },
                { id: 'activity', label: 'Activity' },
              ]}
              defaultActiveTabId="chat"
              onClose={onClose}
            />
          }
        >
          <Box inlinePadding="lg" blockPadding="md">
            <TextLockup>
              Omit `onActionClick` (and leave `action` undefined) to render only the segmented
              control and corner actions — the plus button slot stays empty.
            </TextLockup>
          </Box>
        </Panel>
      )}
    </Trigger>
  ),
};

export const WithAiroHeaderCustomAction: Story = {
  name: 'With Airo header (custom action)',
  render: (args, context) => (
    <Trigger label="Open Airo panel" initialShow={autoOpenInStoryView(context)}>
      {({ show, onClose }) => (
        <Panel
          aria-label="Airo"
          {...args}
          show={show}
          onClose={onClose}
          header={
            <Panel.AiroHeader
              tabs={[
                { id: 'chat', label: 'Chat' },
                { id: 'activity', label: 'Activity' },
              ]}
              defaultActiveTabId="chat"
              onClose={onClose}
              action={
                <Button
                  design="secondary"
                  size="small"
                  text="Upgrade"
                  onClick={() => console.log('Upgrade!')}
                />
              }
            />
          }
        >
          <Box inlinePadding="lg" blockPadding="md">
            <TextLockup>
              Pass any ReactNode to the `action` prop to replace the default plus button — for
              example, a labelled CTA, an overflow-menu trigger, or a pair of buttons wrapped in a
              flex row.
            </TextLockup>
          </Box>
        </Panel>
      )}
    </Trigger>
  ),
};

export const RTL: Story = {
  name: 'RTL direction',
  render: (args, context) => <RTLDemo {...args} initialShow={autoOpenInStoryView(context)} />,
};

/**
 * Applies `dir="rtl"` to the document root only while the panel is open, then
 * restores the previous direction on close. The panel portals to
 * `document.body` (outside the story wrapper), so a wrapper `<div dir="rtl">`
 * would not reach it — `documentElement` is the correct target. Gating on
 * `show` keeps other stories on the autodocs page (which all mount at once)
 * from inheriting RTL from this one.
 */
function RTLDemo({
  initialShow = false,
  ...args
}: React.ComponentProps<typeof Panel> & { initialShow?: boolean }) {
  const [show, setShow] = useState(initialShow);

  useEffect(() => {
    if (!show) return;
    const html = document.documentElement;
    const prev = html.dir;
    html.dir = 'rtl';
    return () => {
      html.dir = prev;
    };
  }, [show]);

  return (
    <Box inlinePadding="lg" blockPadding="lg">
      <Button design="primary" text="فتح اللوحة" onClick={() => setShow(true)} />
      <Panel {...args} show={show} onClose={() => setShow(false)} title="لوحة جانبية">
        <Box inlinePadding="lg" blockPadding="md">
          <TextLockup>في الاتجاه من اليمين إلى اليسار، ينزلق اللوح من الحافة اليسرى.</TextLockup>
        </Box>
      </Panel>
    </Box>
  );
}
