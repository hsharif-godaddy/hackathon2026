import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import '@ux/growl/styles';
import AsyncIcon from '@ux/icon/async-icon.js';
import TextLockup from '@ux/text-lockup';
import { type ChangeEvent, useCallback, useRef, useState } from 'react';

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
import { FloatingFooter } from '../floating-footer';
import '../floating-footer/styles.css';
import { AiroHeader } from '../panel-chrome';
import '../panel-chrome/styles.css';
import { FullscreenDialog } from './index';
import './styles.css';

const meta: Meta<typeof FullscreenDialog> = {
  title: 'Usage Examples / Venture Home / Fullscreen Chat Dialog',
  component: FullscreenDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A fully composed `FullscreenDialog` layout: the Airo header with tab navigation, a scrollable AI conversation, a `ChoiceList` decision prompt, and a `PromptBox` typeahead footer — all in a modal, full-viewport surface. The dialog always covers the full viewport — edge-to-edge, no margins, no border-radius. **Floating composer** moves the borderless **`PromptBox`** (full toolbar: attach, token budget, mic) into **`FullscreenDialog`’s `footer`** with **`footerChrome="floating"`** and **`FloatingFooter`** — same pattern as **Examples / Chat Panel → Fixed conversation (floating composer)**.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof FullscreenDialog>;

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

// ── Shared conversation body ──────────────────────────────────────────────

function Conversation({
  decided,
  decisionValue,
  onDecision,
}: {
  decided: boolean;
  decisionValue: string;
  onDecision: (value: string) => void;
}) {
  return (
    <Box inlinePadding="lg" blockPadding="md" orientation="vertical" gap="md">
      <UserMessage>
        Hey! I just launched my small business website and I'm not sure what to focus on first to
        get more customers.
      </UserMessage>

      <AgentMessage>{AGENT_MSG_1}</AgentMessage>

      <UserMessage>
        My site already looks decent on mobile. Should I prioritize SEO or email first?
      </UserMessage>

      <AgentMessage>{AGENT_MSG_2}</AgentMessage>

      {!decided ? (
        <ChoiceList ariaLabel="Which should we focus on first?" onDecision={onDecision}>
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
  );
}

function ChatFullscreenDialogDemo({
  initialShow = false,
  floatingFooter = false,
}: {
  initialShow?: boolean;
  floatingFooter?: boolean;
}) {
  const [show, setShow] = useState(initialShow);
  const [activeTab, setActiveTab] = useState('chat');
  const [decided, setDecided] = useState(false);
  const [decisionValue, setDecisionValue] = useState('');
  const [pending, setPending] = useState(false);
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const tokenPercent = 68;
  const tokenBudgetAria = `Token budget ${tokenPercent}% remaining`;

  const handleDecision = useCallback((value: string) => {
    setDecided(true);
    setDecisionValue(value);
    Growl.addGrowlMessage({
      id: `fsd-decision-${Date.now()}`,
      title: 'Choice made',
      children: `"${DECISION_LABELS[value] ?? value}"`,
      emphasis: 'success',
      lifetime: 3500,
    });
  }, []);

  const handleSubmit = useCallback((text: string) => {
    setPending(true);
    Growl.addGrowlMessage({
      id: `fsd-submit-${Date.now()}`,
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
      id: `fsd-stop-${Date.now()}`,
      title: 'Stopped',
      children: 'Generation cancelled.',
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
      id: `fsd-files-${Date.now()}`,
      title: 'Files selected',
      children: `${n} file(s)`,
      emphasis: 'info',
      lifetime: 3500,
    });
    ev.target.value = '';
  }, []);

  const handleFloatingTokenBudget = useCallback(() => {
    Growl.addGrowlMessage({
      id: `fsd-token-${Date.now()}`,
      title: 'Token budget',
      children: 'Would open usage dialog (example).',
      emphasis: 'info',
      lifetime: 3500,
    });
  }, []);

  const handleFloatingMic = useCallback(() => {
    Growl.addGrowlMessage({
      id: `fsd-mic-${Date.now()}`,
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

  const floatingDialogFooter = (
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
    <Box inlinePadding="lg" blockPadding="lg">
      <Growl closeLabel="Dismiss all" />

      <TextLockup title="Page content behind the dialog" />
      <TextLockup>
        Opening the dialog will dim this page and trap focus inside. Press Escape or the close
        button to return here.
      </TextLockup>

      <Box blockPadding="sm">
        <Button design="primary" text="Open Airo dialog" onClick={() => setShow(true)} />
      </Box>

      <FullscreenDialog
        show={show}
        onClose={() => setShow(false)}
        aria-label="Airo"
        footerChrome={floatingFooter ? 'floating' : undefined}
        footer={
          floatingFooter ? <FloatingFooter>{floatingDialogFooter}</FloatingFooter> : undefined
        }
        header={
          <AiroHeader
            tabs={TABS}
            showSections={false}
            onClose={() => setShow(false)}
            onActionClick={() => {}}
            actionLabel="New conversation"
          />
        }
      >
        <ChatLayout
          header={
            <AiroHeader.Sections
              tabs={TABS}
              activeTabId={activeTab}
              onTabChange={setActiveTab}
              onActionClick={() => {}}
              actionLabel="New conversation"
            />
          }
          footer={
            floatingFooter ? undefined : (
              <PromptBox
                placeholder="Ask a follow-up question…"
                pending={pending}
                suggestions={suggestions}
                onSuggestionsRequest={handleSuggestionsRequest}
                onSuggestionAccept={handleSuggestionAccept}
                onSubmit={handleSubmit}
                onStop={handleStop}
              />
            )
          }
        >
          <Conversation
            decided={decided}
            decisionValue={decisionValue}
            onDecision={handleDecision}
          />
        </ChatLayout>
      </FullscreenDialog>
    </Box>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────

const autoOpenInStoryView = (context: { viewMode?: string }) => context.viewMode === 'story';

/**
 * A fully composed fullscreen chat dialog: Airo header with tab navigation, a
 * scrollable AI conversation, a `ChoiceList` decision prompt, and a `PromptBox`
 * typeahead footer — covering the full viewport edge-to-edge.
 *
 * **Try it:**
 * - Click **Open Airo dialog** to open the modal with a scrim and focus trap.
 * - Pick a `ChoiceList` option to branch the conversation.
 * - Type in the footer field to trigger typeahead suggestions — try
 *   **"help"**, **"email"**, or **"can"**.
 * - Submit a follow-up prompt to see the pending / stop flow.
 * - Scroll the conversation body to watch the Airo header hide on scroll-down
 *   and reappear on scroll-up.
 * - Press Escape or the close button to dismiss and return focus to the page.
 */
export const FullChatLayout: Story = {
  name: 'Full chat layout',
  render: (_args, context) => (
    <ChatFullscreenDialogDemo initialShow={autoOpenInStoryView(context)} />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Full-viewport modal — covers the entire screen edge-to-edge. Focus is trapped inside; Escape or the close button dismisses and restores focus.',
      },
    },
  },
};

/**
 * Same conversation as **Full chat layout**, but the composer is a
 * **`FloatingFooter`** + borderless **`PromptBox`** (attach, **`TokenBudgetButton`**,
 * mic) in **`FullscreenDialog`’s `footer`** with **`footerChrome="floating"`**.
 * `ChatLayout` does not pass `footer`.
 */
export const FullChatLayoutFloatingComposer: Story = {
  name: 'Full chat layout (floating composer)',
  render: (_args, context) => (
    <ChatFullscreenDialogDemo floatingFooter initialShow={autoOpenInStoryView(context)} />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Fullscreen modal with **`footerChrome="floating"`**: transparent footer band, **`FloatingFooter`** raised capsule, and the same full borderless toolbar as **Input / PromptBox → Borderless + toolbar**.',
      },
    },
  },
};
