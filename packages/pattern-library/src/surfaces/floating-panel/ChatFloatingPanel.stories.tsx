import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import '@ux/growl/styles';
import AsyncIcon from '@ux/icon/async-icon.js';
import TextLockup from '@ux/text-lockup';
import { type ChangeEvent, useCallback, useLayoutEffect, useRef, useState } from 'react';

import { AgentMessage } from '../../chat/agent-message';
import '../../chat/agent-message/styles.css';
import { ChatLayout } from '../../chat/chat-layout';
import '../../chat/chat-layout/styles.css';
import { ChoiceList, ChoiceListItemContent } from '../../input/choice-list';
import '../../input/choice-list/styles.css';
import { UserMessage } from '../../chat/user-message';
import '../../chat/user-message/styles.css';
import { PromptBox, type PromptSuggestion, TokenBudgetButton } from '../../input/prompt-box';
import '../../input/prompt-box/styles.css';
import { AiroHeader } from '../panel-chrome';
import '../panel-chrome/styles.css';
import { FloatingFooter } from '../floating-footer';
import '../floating-footer/styles.css';
import type { FloatingPanelDockedTo } from './FloatingPanel';
import { FloatingPanel } from './index';
import './styles.css';

const meta: Meta<typeof FloatingPanel> = {
  title: 'Usage Examples / Venture Home / Floating Chat Panel',
  component: FloatingPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A fully composed `FloatingPanel` layout: the Airo header with tab navigation, a scrollable AI conversation, a `ChoiceList` decision prompt, and a `PromptBox` typeahead footer — all in a draggable, resizable, non-modal window. Drag by the header. Resize from any edge or corner. **Split workspace (docked, floating composer)** starts **docked** into a **`FloatingPanel.DropZone`** in the page flow (same interaction as **Surfaces / Floating Panel → Drop zone (in-page sidebar)**) with **`footerChrome="floating"`** and a full borderless toolbar; the drop zone is **100vh** and **`position: sticky`** so the assistant column stays in view when the main column scrolls.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof FloatingPanel>;

// ── Static data ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'chat', label: 'Chat' },
  { id: 'activity', label: 'Activity' },
  { id: 'history', label: 'History' },
];

const CHAT_SUGGESTIONS: PromptSuggestion[] = [
  { id: 'cs-1', label: 'How long does SEO typically take to show results?' },
  { id: 'cs-2', label: 'Help me write a welcome email sequence' },
  { id: 'cs-3', label: 'How many emails should I send per week?' },
  { id: 'cs-4', label: 'Can you review my homepage copy?' },
  { id: 'cs-5', label: 'Can you recommend an email platform for small businesses?' },
];

const DECISION_LABELS: Record<string, string> = {
  email: 'Set up email marketing from scratch',
  seo: 'Audit and improve my SEO foundation',
  conversion: 'Review my site for conversion improvements',
};

const DECISION_RESPONSES: Record<string, string> = {
  email: `Great choice — email marketing is one of the highest-ROI channels for new businesses, and starting early means you build an audience before you even need it.

Let's set up a simple three-email sequence:

1. A **welcome email** that goes out the moment someone subscribes.
2. A **value email** two or three days later with your best tip or resource.
3. A **soft CTA email** a week after that, for readers who are ready to convert.

I'll walk you through each one step by step.`,
  seo: `Smart move — SEO is a long game, but the compounding returns are real.

We'll start with three things in order:

1. **Technical audit** — page speed, crawlability, and broken links.
2. **Keyword clusters** — identify three or four topics most likely to drive qualified traffic in your niche.
3. **Content outline** — draft a plan for the first cluster.

I'll guide you through each step.`,
  conversion: `Solid instinct — a site that converts better multiplies the value of every other channel you invest in.

We'll start by:

- Mapping your current user journey and identifying the biggest drop-off points.
- Prioritizing the highest-impact fixes, starting with your homepage.
- Testing one change at a time so you can measure what's actually moving the needle.`,
};

// ── Conversation content ──────────────────────────────────────────────────

const AGENT_MSG_1 = `Welcome — and congrats on the launch! That's a big milestone.

Based on what I see from early-stage businesses, there are **three areas** that consistently drive the most impact:

- **Discoverability (SEO)** — long game, but once pages rank the traffic is essentially free and self-sustaining.
- **Conversion** — more immediate. Strong CTAs, fast load times, and a mobile-first layout are the big levers.
- **Owned audience (email)** — one of the highest ROI-per-dollar channels, and the sooner you start building your list, the better.`;

const AGENT_MSG_2 = `Good instinct to check mobile off the list first — that's a meaningful head start.

Here's how I'd frame the decision:

1. **Email first** — gives you a return channel for every visitor, from any source. A list of fifty people is enough to get real signal.
2. **SEO second** — rewards patience. Expect 3–6 months before meaningful organic traffic, but the payoff compounds.
3. **Layer them** — running email under SEO means both channels reinforce each other rather than competing for your attention.

Which direction appeals to you most?`;

// ── Demo component ────────────────────────────────────────────────────────

function ChatFloatingPanelDemo({ initialShow = false }: { initialShow?: boolean }) {
  const [show, setShow] = useState(initialShow);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [decided, setDecided] = useState(false);
  const [decisionValue, setDecisionValue] = useState('');
  const [pending, setPending] = useState(false);
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);

  const handleDecision = useCallback((value: string) => {
    setDecided(true);
    setDecisionValue(value);
    Growl.addGrowlMessage({
      id: `fp-decision-${Date.now()}`,
      title: 'Choice made',
      children: `"${DECISION_LABELS[value] ?? value}"`,
      emphasis: 'success',
      lifetime: 3500,
    });
  }, []);

  const handleSubmit = useCallback((text: string) => {
    setPending(true);
    Growl.addGrowlMessage({
      id: `fp-submit-${Date.now()}`,
      title: 'Prompt sent',
      children: `"${text}"`,
      emphasis: 'info',
      lifetime: 3500,
    });
    setTimeout(() => setPending(false), 2000);
  }, []);

  const handleStop = useCallback(() => {
    setPending(false);
    Growl.addGrowlMessage({
      id: `fp-stop-${Date.now()}`,
      title: 'Stopped',
      children: 'Generation canceled.',
      emphasis: 'info',
      lifetime: 3500,
    });
  }, []);

  const handleSuggestionsRequest = useCallback((query: string) => {
    setSuggestions(
      CHAT_SUGGESTIONS.filter((s) => s.label.toLowerCase().includes(query.toLowerCase())),
    );
  }, []);

  const handleSuggestionAccept = useCallback(() => setSuggestions([]), []);

  return (
    <Box inlinePadding="lg" blockPadding="lg">
      <Growl closeLabel="Dismiss all" />

      <TextLockup title="Page content behind the panel" />
      <TextLockup>
        The panel floats above this page content. Drag it by the header to reposition it. Resize
        from any edge or corner. Arrow keys (with the header focused) move it; Shift+Arrow keys
        resize it.
      </TextLockup>

      <Box blockPadding="sm">
        <Button design="primary" text="Open Airo panel" onClick={() => setShow(true)} />
      </Box>

      <FloatingPanel
        show={show}
        onClose={() => setShow(false)}
        aria-label="Airo"
        defaultPosition={{ x: 32, y: 80 }}
        defaultSize={{ width: 400, height: 580 }}
        expanded={expanded}
        onExpandedChange={setExpanded}
        header={
          <AiroHeader
            tabs={TABS}
            showSections={!expanded}
            activeTabId={activeTab}
            onTabChange={setActiveTab}
            onClose={() => setShow(false)}
            onActionClick={() => {}}
            actionLabel="New conversation"
            expanded={expanded}
            onExpandedToggle={() => setExpanded((v) => !v)}
          />
        }
        footer={
          !expanded ? (
            <PromptBox
              placeholder="Ask a follow-up question…"
              pending={pending}
              suggestions={suggestions}
              onSuggestionsRequest={handleSuggestionsRequest}
              onSuggestionAccept={handleSuggestionAccept}
              onSubmit={handleSubmit}
              onStop={handleStop}
            />
          ) : undefined
        }
      >
        <ChatLayout
          autoScroll="smart-bottom"
          header={
            expanded ? (
              <AiroHeader.Sections
                tabs={TABS}
                activeTabId={activeTab}
                onTabChange={setActiveTab}
                onActionClick={() => {}}
                actionLabel="New conversation"
              />
            ) : undefined
          }
          footer={
            expanded ? (
              <PromptBox
                placeholder="Ask a follow-up question…"
                pending={pending}
                suggestions={suggestions}
                onSuggestionsRequest={handleSuggestionsRequest}
                onSuggestionAccept={handleSuggestionAccept}
                onSubmit={handleSubmit}
                onStop={handleStop}
              />
            ) : undefined
          }
        >
          <Box inlinePadding="lg" blockPadding="md" orientation="vertical" gap="md">
            <UserMessage>
              Hey! I just launched my small business website and I'm not sure what to focus on first
              to get more customers.
            </UserMessage>

            <AgentMessage>{AGENT_MSG_1}</AgentMessage>

            <UserMessage>
              That's really helpful context. My site already looks decent on mobile. Should I
              prioritize SEO or email first?
            </UserMessage>

            <AgentMessage>{AGENT_MSG_2}</AgentMessage>

            {!decided ? (
              <ChoiceList ariaLabel="Which should we focus on first?" onDecision={handleDecision}>
                <ChoiceList.Item value="email">
                  <ChoiceListItemContent description="Set up email marketing from scratch" />
                </ChoiceList.Item>
                <ChoiceList.Item value="seo">
                  <ChoiceListItemContent description="Audit and improve my SEO foundation" />
                </ChoiceList.Item>
                <ChoiceList.Item value="conversion">
                  <ChoiceListItemContent description="Review my site for conversion improvements" />
                </ChoiceList.Item>
              </ChoiceList>
            ) : (
              <>
                <UserMessage>{DECISION_LABELS[decisionValue] ?? decisionValue}</UserMessage>
                <AgentMessage>
                  {DECISION_RESPONSES[decisionValue] ?? "Great choice — let's dive in."}
                </AgentMessage>
              </>
            )}
          </Box>
        </ChatLayout>
      </FloatingPanel>
    </Box>
  );
}

function ChatFloatingPanelSplitDockedDemo({ initialShow = false }: { initialShow?: boolean }) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(initialShow);
  const [dockedTo, setDockedTo] = useState<FloatingPanelDockedTo>(null);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [decided, setDecided] = useState(false);
  const [decisionValue, setDecisionValue] = useState('');
  const [pending, setPending] = useState(false);
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const tokenPercent = 68;
  const tokenBudgetAria = `Token budget ${tokenPercent}% remaining`;

  useLayoutEffect(() => {
    if (show && sidebarRef.current) {
      setDockedTo(sidebarRef.current);
    } else if (!show) {
      setDockedTo(null);
    }
  }, [show]);

  const handleDecision = useCallback((value: string) => {
    setDecided(true);
    setDecisionValue(value);
    Growl.addGrowlMessage({
      id: `fp-split-decision-${Date.now()}`,
      title: 'Choice made',
      children: `"${DECISION_LABELS[value] ?? value}"`,
      emphasis: 'success',
      lifetime: 3500,
    });
  }, []);

  const handleSubmit = useCallback((text: string) => {
    setPending(true);
    Growl.addGrowlMessage({
      id: `fp-split-submit-${Date.now()}`,
      title: 'Prompt sent',
      children: `"${text}"`,
      emphasis: 'info',
      lifetime: 3500,
    });
    setTimeout(() => setPending(false), 2000);
  }, []);

  const handleStop = useCallback(() => {
    setPending(false);
    Growl.addGrowlMessage({
      id: `fp-split-stop-${Date.now()}`,
      title: 'Stopped',
      children: 'Generation canceled.',
      emphasis: 'info',
      lifetime: 3500,
    });
  }, []);

  const handleSuggestionsRequest = useCallback((query: string) => {
    setSuggestions(
      CHAT_SUGGESTIONS.filter((s) => s.label.toLowerCase().includes(query.toLowerCase())),
    );
  }, []);

  const handleSuggestionAccept = useCallback(() => setSuggestions([]), []);

  const handleFloatingAttachFiles = useCallback((ev: ChangeEvent<HTMLInputElement>) => {
    const n = ev.target.files?.length ?? 0;
    Growl.addGrowlMessage({
      id: `fp-split-files-${Date.now()}`,
      title: 'Files selected',
      children: `${n} file(s)`,
      emphasis: 'info',
      lifetime: 3500,
    });
    ev.target.value = '';
  }, []);

  const handleFloatingTokenBudget = useCallback(() => {
    Growl.addGrowlMessage({
      id: `fp-split-token-${Date.now()}`,
      title: 'Token budget',
      children: 'Would open usage dialog (example).',
      emphasis: 'info',
      lifetime: 3500,
    });
  }, []);

  const handleFloatingMic = useCallback(() => {
    Growl.addGrowlMessage({
      id: `fp-split-mic-${Date.now()}`,
      title: 'Microphone',
      children: 'Dictation hook (example).',
      emphasis: 'info',
      lifetime: 3500,
    });
  }, []);

  const floatingToolbarStart = (
    <Box displayType="flex" orientation="horizontal" inlineAlignChildren="center">
      <span className="airo-input-prompt-box__attach">
        <Button
          design="tertiary"
          size="small"
          icon={<AsyncIcon icon="plus" />}
          aria-label="Attach files"
          type="button"
          onClick={() => fileRef.current?.click()}
        />
      </span>
      <TokenBudgetButton
        percent={tokenPercent}
        aria-label={tokenBudgetAria}
        onPress={handleFloatingTokenBudget}
      />
    </Box>
  );

  const floatingBeforeSubmit = (
    <span className="airo-input-prompt-box__mic">
      <Button
        design="tertiary"
        size="small"
        icon={<AsyncIcon icon="mic" />}
        aria-label="Voice input"
        type="button"
        onClick={handleFloatingMic}
      />
    </span>
  );

  const floatingPanelFooter = (
    <>
      <input ref={fileRef} type="file" hidden multiple onChange={handleFloatingAttachFiles} />
      <PromptBox
        appearance="borderless"
        placeholder={'Ask a follow-up… try "help" or "email"'}
        pending={pending}
        suggestions={suggestions}
        onSuggestionsRequest={handleSuggestionsRequest}
        onSuggestionAccept={handleSuggestionAccept}
        onSubmit={handleSubmit}
        onStop={handleStop}
        toolbarStart={floatingToolbarStart}
        beforeSubmit={floatingBeforeSubmit}
      />
    </>
  );

  return (
    <Box orientation="vertical">
      <Growl closeLabel="Dismiss all" />
      <Box displayType="flex" orientation="horizontal" blockAlignChildren="start">
        <FloatingPanel.DropZone
          ref={sidebarRef}
          style={{
            '--airo-fp-drop-zone-width': 'min(24rem, 100vw)',
            position: 'sticky',
            top: 0,
            alignSelf: 'flex-start',
            height: '100vh',
            minHeight: '100vh',
            maxHeight: '100vh',
          }}
        />
        <Box
          inlinePadding="lg"
          blockPadding="lg"
          orientation="vertical"
          gap="md"
          style={{ flex: '1 1 auto', minInlineSize: 0 }}
        >
          <TextLockup title="Main workspace" />
          <TextLockup>
            The assistant column is a <code>FloatingPanel.DropZone</code> kept{' '}
            <strong>100vh</strong> tall and <strong>sticky</strong> (<code>top: 0</code>,{' '}
            <code>align-self: flex-start</code> in this flex row) so the docked panel stays in view
            when you scroll this long column. When the panel is open it starts{' '}
            <strong>docked in-page</strong>. Drag the <strong>header handle pill</strong> off the
            column to undock and float; drag back over the zone or use snap targets to re-dock (see{' '}
            <strong>Surfaces / Floating Panel → Drop zone (in-page sidebar)</strong>).
          </TextLockup>
          <Box blockPadding="sm">
            <Button design="primary" text="Open Airo panel" onClick={() => setShow(true)} />
          </Box>
          {Array.from({ length: 12 }, (_, i) => (
            <TextLockup
              // biome-ignore lint/suspicious/noArrayIndexKey: demo scroll filler
              key={i}
              title={`Scroll filler ${i + 1}`}
            >
              Scroll the page — the assistant column should stay pinned to the viewport while this
              content moves.
            </TextLockup>
          ))}
        </Box>

        <FloatingPanel
          show={show}
          onClose={() => setShow(false)}
          aria-label="Airo"
          dropZones={[sidebarRef]}
          dockedTo={dockedTo}
          onDock={(target) => setDockedTo(target)}
          onUndock={() => setDockedTo(null)}
          defaultPosition={{ x: 400, y: 80 }}
          defaultSize={{ width: 400, height: 580 }}
          expanded={expanded}
          onExpandedChange={setExpanded}
          footerChrome="floating"
          header={
            <AiroHeader
              tabs={TABS}
              showSections={!expanded}
              activeTabId={activeTab}
              onTabChange={setActiveTab}
              onClose={() => setShow(false)}
              onActionClick={() => {}}
              actionLabel="New conversation"
              expanded={expanded}
              onExpandedToggle={() => setExpanded((v) => !v)}
            />
          }
          footer={<FloatingFooter>{floatingPanelFooter}</FloatingFooter>}
        >
          <ChatLayout
            autoScroll="smart-bottom"
            header={
              expanded ? (
                <AiroHeader.Sections
                  tabs={TABS}
                  activeTabId={activeTab}
                  onTabChange={setActiveTab}
                  onActionClick={() => {}}
                  actionLabel="New conversation"
                />
              ) : undefined
            }
            footer={undefined}
          >
            <Box inlinePadding="lg" blockPadding="md" orientation="vertical" gap="md">
              <UserMessage>
                Hey! I just launched my small business website and I&apos;m not sure what to focus
                on first to get more customers.
              </UserMessage>

              <AgentMessage>{AGENT_MSG_1}</AgentMessage>

              <UserMessage>
                That&apos;s really helpful context. My site already looks decent on mobile. Should I
                prioritize SEO or email first?
              </UserMessage>

              <AgentMessage>{AGENT_MSG_2}</AgentMessage>

              {!decided ? (
                <ChoiceList ariaLabel="Which should we focus on first?" onDecision={handleDecision}>
                  <ChoiceList.Item value="email">
                    <ChoiceListItemContent description="Set up email marketing from scratch" />
                  </ChoiceList.Item>
                  <ChoiceList.Item value="seo">
                    <ChoiceListItemContent description="Audit and improve my SEO foundation" />
                  </ChoiceList.Item>
                  <ChoiceList.Item value="conversion">
                    <ChoiceListItemContent description="Review my site for conversion improvements" />
                  </ChoiceList.Item>
                </ChoiceList>
              ) : (
                <>
                  <UserMessage>{DECISION_LABELS[decisionValue] ?? decisionValue}</UserMessage>
                  <AgentMessage>
                    {DECISION_RESPONSES[decisionValue] ?? "Great choice — let's dive in."}
                  </AgentMessage>
                </>
              )}
            </Box>
          </ChatLayout>
        </FloatingPanel>
      </Box>
    </Box>
  );
}

// ── Story ─────────────────────────────────────────────────────────────────

const autoOpenInStoryView = (context: { viewMode?: string }) => context.viewMode === 'story';

/**
 * A fully composed floating chat panel: Airo header with tab navigation, a
 * scrollable AI conversation, a `ChoiceList` decision prompt, and a `PromptBox`
 * typeahead footer — all in a draggable, resizable, non-modal window.
 *
 * **Try it:**
 * - Click **Open Airo panel** and drag the floating window by its header.
 * - Resize from any edge or corner handle.
 * - Pick a `ChoiceList` option to branch the conversation.
 * - Type in the footer field to trigger typeahead suggestions — try
 *   **"help"**, **"email"**, or **"can"**.
 * - Press Arrow keys (with the header focused) to move the panel by 8 px;
 *   Shift+Arrow to resize.
 * - Press Escape or click the close button to dismiss.
 */
export const FullChatLayout: Story = {
  name: 'Full chat layout',
  render: (_args, context) => <ChatFloatingPanelDemo initialShow={autoOpenInStoryView(context)} />,
  parameters: {
    docs: {
      description: {
        story:
          'Drag by the header, resize from any edge, pick a `ChoiceList` option to branch the conversation, then use the `PromptBox` to send a follow-up. The panel floats non-modally above the page.',
      },
    },
  },
};

/**
 * Split workspace: a **`FloatingPanel.DropZone`** in the leading column and the
 * same chat composition as **Full chat layout**, with **`footerChrome="floating"`**
 * and a **borderless** **`PromptBox`** (attach, **`TokenBudgetButton`**, mic) inside
 * **`FloatingFooter`**. The drop zone uses **`height` / `min-height` / `max-height: 100vh`**
 * with **`position: sticky`** and **`top: 0`** (and **`align-self: flex-start`** on the flex row)
 * so the docked column stays viewport-tall and pins while the main workspace scrolls.
 * The panel **opens docked** into the zone; drag the **header handle pill** off the column to
 * **undock** and float again.
 *
 * **Try it:**
 * - Click **Open Airo panel** — it lands docked in the left column.
 * - Drag the handle pill away from the column edge to undock, then drag over the
 *   column or toward viewport edges to re-dock (see **Surfaces / Floating Panel →
 *   Drop zone (in-page sidebar)** for the interaction model).
 * - Scroll the main column — the assistant **DropZone** stays **100vh** and **sticky** at the top
 *   of the viewport.
 * - Expand / collapse and use the floating composer typeahead as in **Full chat layout**.
 */
export const SplitWorkspaceDockedFloatingComposer: Story = {
  name: 'Split workspace (docked, floating composer)',
  render: (_args, context) => (
    <ChatFloatingPanelSplitDockedDemo initialShow={autoOpenInStoryView(context)} />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Drop zone is **100vh** + **`position: sticky`**, **`top: 0`**, **`align-self: flex-start`** beside a long scrolling main column. Starts **docked** with **`footerChrome="floating"`**; **undock** via the header handle pill.',
      },
    },
  },
};
