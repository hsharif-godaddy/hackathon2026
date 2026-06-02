import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import '@ux/growl/styles';
import AsyncIcon from '@ux/icon/async-icon.js';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
import { Panel } from './index';
import './styles.css';

const meta: Meta<typeof Panel> = {
  title: 'Usage Examples / Venture Home / Chat Panel',
  component: Panel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'A fully composed `Panel` layout showing every chat surface working in concert: the Airo header with tab navigation, UXCore2-styled `UserMessage` / `AgentMessage` turns (including a `UserMessage.Gallery` attachment demo), a `ChoiceList` decision prompt, and a typeahead `PromptBox` footer. Two variants: a static transcript and a streaming replay that progressively reveals the whole conversation. **Floating borderless composer** uses the same transcript with **`FloatingFooter` + borderless `PromptBox` in `Panel`’s footer** and **`footerChrome="floating"`** so the chrome gutter is transparent with no footer shadow (see **Surfaces / PanelChrome → Floating footer chrome**). For a **split workspace** with the assistant docked in-page and draggable off again, see **Examples / Floating Chat Panel → Split workspace (docked, floating composer)** (`FloatingPanel.DropZone`).',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof Panel>;

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

const HERO_IMAGE = 'https://placehold.co/800x500/8866ee/white?text=Homepage+Hero';
const FOOTER_IMAGE = 'https://placehold.co/800x500/ee6688/white?text=Site+Footer';

const AGENT_ARIA_LABEL = 'Launch coach';

const DECISION_LABELS: Record<string, string> = {
  email: 'Set up email marketing from scratch',
  seo: 'Audit and improve my SEO foundation',
  conversion: 'Review my site for conversion improvements',
};

// ── Transcript content ────────────────────────────────────────────────────

const USER_MSG_1_NODE = (
  <UserMessage>
    <UserMessage.Gallery>
      <UserMessage.Image src={HERO_IMAGE} alt="homepage-hero.png" />
      <UserMessage.Image src={FOOTER_IMAGE} alt="site-footer.png" />
      <UserMessage.File name="brand-guidelines.pdf" />
    </UserMessage.Gallery>
    Hey! I just launched my small business website and I'm not sure what to focus on first to get
    more customers. Here are the hero and footer shots plus our brand guidelines.
  </UserMessage>
);

const AGENT_MSG_1_MD = `Welcome — and congrats on the launch. That's a big milestone.

Based on what I see from early-stage businesses, there are **three areas** that consistently drive the most impact:

- **Discoverability (SEO)** — you're planting seeds that take months to grow, but once pages are ranking the traffic is essentially free and self-sustaining. Site structure, page speed, and a small set of well-researched keyword clusters matter most here.
- **Conversion** — if your site is already getting traffic from any source, making it clearer what visitors should do next can have measurable impact within days. Strong CTAs, fast load times, and a mobile-first layout are the big levers.
- **Owned audience (email)** — often underestimated by new businesses. It has one of the highest ROI-per-dollar of any channel, and the sooner you start building your list the better — you're growing an asset you actually own, independent of any algorithm.
`;

const USER_MSG_2_NODE = (
  <UserMessage>
    That's really helpful context. My site already looks decent on mobile. Should I prioritize SEO
    or email first?
  </UserMessage>
);

const AGENT_MSG_2_MD = `Good instinct to check mobile off the list first — that's a meaningful head start.

Here's how I'd frame the SEO vs. email decision:

1. SEO rewards patience. You'll likely wait three to six months before you see meaningful organic traffic, and the payoff is heavily front-loaded toward the work you put in early.
2. Email gives you a return channel for every visitor you drive from any source — paid, social, word of mouth, even your early SEO efforts. A list of fifty people is enough to get real signal.
3. For most businesses at your stage, layering email *under* SEO compounds both channels.

I don't want to prescribe without knowing more about your goals. Which of these three directions appeals to you most?`;

const DECISION_RESPONSES: Record<string, string> = {
  email: `Great choice — email marketing is one of the highest-ROI channels for new businesses, and starting early means you build an audience before you even need it.

Let's set up a simple sequence:

1. A **welcome email** that goes out the moment someone subscribes.
2. A **value email** two or three days later with your best-performing tip.
3. A **soft CTA email** a week after that to convert readers who are ready.

I'll walk you through the whole thing step by step.`,
  seo: `Smart move — SEO is a long game, but the compounding returns are real.

We'll start with three things in order:

1. A technical audit of your site (page speed, crawlability, broken links).
2. Identifying three or four keyword clusters most likely to drive qualified traffic in your niche.
3. Drafting a content outline for the first cluster.

I'll guide you through each step.`,
  conversion: `Solid instinct — a site that converts better multiplies the value of every other channel you invest in.

We'll start by mapping your current user journey, identifying the biggest drop-off points, and prioritizing the highest-impact fixes — starting with the homepage.`,
};

// ── Script model ──────────────────────────────────────────────────────────

type ScriptItem =
  | { kind: 'user'; id: string; node: React.ReactNode }
  | { kind: 'agent'; id: string; markdown: string; ariaLabel?: string }
  | { kind: 'choice'; id: string };

const BASE_SCRIPT: ScriptItem[] = [
  { kind: 'user', id: 'user-1', node: USER_MSG_1_NODE },
  { kind: 'agent', id: 'agent-1', markdown: AGENT_MSG_1_MD, ariaLabel: AGENT_ARIA_LABEL },
  { kind: 'user', id: 'user-2', node: USER_MSG_2_NODE },
  { kind: 'agent', id: 'agent-2', markdown: AGENT_MSG_2_MD, ariaLabel: AGENT_ARIA_LABEL },
  { kind: 'choice', id: 'choice' },
];

function buildDecisionScript(value: string): ScriptItem[] {
  const label = DECISION_LABELS[value] ?? value;
  const response = DECISION_RESPONSES[value] ?? "Great choice — let's dive in.";
  return [
    {
      kind: 'user',
      id: `user-${value}`,
      node: <UserMessage>{label}</UserMessage>,
    },
    {
      kind: 'agent',
      id: `agent-${value}`,
      markdown: response,
      ariaLabel: AGENT_ARIA_LABEL,
    },
  ];
}

// ── Streaming player ──────────────────────────────────────────────────────

// 200 ms lead-in before the first token, so viewers register the empty
// bubble the way they would the first frame of a real streaming call.
const STREAM_LEAD_IN_MS = 200;
// Dwell between turns — long enough that the reader registers the previous
// message before the next one arrives, short enough that the demo doesn't
// drag across a five-turn transcript.
const INTER_TURN_DELAY_MS = 550;

interface PlayHandlers {
  onUserOrChoice: (item: ScriptItem) => void;
  onAgentStart: (item: Extract<ScriptItem, { kind: 'agent' }>) => void;
  onAgentUpdate: (partial: string) => void;
  onAgentComplete: (item: Extract<ScriptItem, { kind: 'agent' }>) => void;
  onDone?: () => void;
}

/**
 * Imperative player for a `ScriptItem[]`. User / choice items reveal
 * immediately via `onUserOrChoice`; agent items stream their markdown
 * token-by-token (2–7 chars every 25–90 ms, matching the cadence of the
 * `AgentMessage` streaming story) through the `onAgent*` callbacks.
 *
 * Returns a cancel handle — call it on effect teardown so pending timers
 * don't fire after unmount or replay.
 */
function playScript(script: ScriptItem[], handlers: PlayHandlers): { cancel: () => void } {
  let cancelled = false;
  const timers: ReturnType<typeof setTimeout>[] = [];

  function schedule(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      if (cancelled) return;
      fn();
    }, ms);
    timers.push(t);
  }

  function playStep(i: number) {
    if (cancelled) return;
    const item = script[i];
    if (!item) {
      handlers.onDone?.();
      return;
    }
    if (item.kind === 'agent') {
      const agent = item;
      const { markdown } = agent;
      handlers.onAgentStart(agent);
      let index = 0;
      const tick = () => {
        if (cancelled) return;
        const chunkSize = 2 + Math.floor(Math.random() * 6);
        index = Math.min(index + chunkSize, markdown.length);
        handlers.onAgentUpdate(markdown.slice(0, index));
        if (index < markdown.length) {
          schedule(tick, 25 + Math.random() * 65);
        } else {
          handlers.onAgentComplete(agent);
          schedule(() => playStep(i + 1), INTER_TURN_DELAY_MS);
        }
      };
      schedule(tick, STREAM_LEAD_IN_MS);
    } else {
      handlers.onUserOrChoice(item);
      schedule(() => playStep(i + 1), INTER_TURN_DELAY_MS);
    }
  }

  schedule(() => playStep(0), STREAM_LEAD_IN_MS);

  return {
    cancel() {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
    },
  };
}

// ── Item renderer ─────────────────────────────────────────────────────────

function renderScriptItem(item: ScriptItem, opts: { onDecision?: (value: string) => void } = {}) {
  if (item.kind === 'user') {
    return <div key={item.id}>{item.node}</div>;
  }
  if (item.kind === 'agent') {
    return (
      <AgentMessage key={item.id} ariaLabel={item.ariaLabel}>
        {item.markdown}
      </AgentMessage>
    );
  }
  return (
    <ChoiceList
      key={item.id}
      ariaLabel="Which should we focus on first?"
      onDecision={opts.onDecision}
    >
      <ChoiceList.Item value="email">
        <ChoiceListItemContent description={DECISION_LABELS.email} />
      </ChoiceList.Item>
      <ChoiceList.Item value="seo">
        <ChoiceListItemContent description={DECISION_LABELS.seo} />
      </ChoiceList.Item>
      <ChoiceList.Item value="conversion">
        <ChoiceListItemContent description={DECISION_LABELS.conversion} />
      </ChoiceList.Item>
    </ChoiceList>
  );
}

// ── Demo component ────────────────────────────────────────────────────────

type ChatPanelDemoProps = React.ComponentProps<typeof Panel> & {
  initialShow?: boolean;
  /**
   * When `true`, **`Panel`** passes **`footerChrome="floating"`** so the chrome
   * footer gutter is transparent with no footer shadow; horizontal inset uses
   * the **`lg`** density step and bottom inset **`md`**. **`FloatingFooter` +
   * borderless `PromptBox`** render in **`Panel`'s footer**. `ChatLayout` does not receive `footer`.
   */
  floatingComposer?: boolean;
  /**
   * When `true`, the conversation replays progressively: user / choice
   * turns appear one by one, agent turns stream their markdown
   * token-by-token, and a **Replay** button re-runs the timeline from
   * the start.
   */
  streaming?: boolean;
};

function ChatPanelDemo({
  initialShow = false,
  streaming = false,
  floatingComposer = false,
  ...args
}: ChatPanelDemoProps) {
  const [show, setShow] = useState(initialShow);
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [pending, setPending] = useState(false);
  const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);

  // Base transcript state.
  const [baseVisible, setBaseVisible] = useState<ScriptItem[]>(streaming ? [] : BASE_SCRIPT);
  const [baseDone, setBaseDone] = useState(!streaming);

  // Post-decision transcript state.
  const [decisionValue, setDecisionValue] = useState<string | null>(null);
  const [decisionVisible, setDecisionVisible] = useState<ScriptItem[]>([]);

  // Currently-streaming agent (either base or decision, never both at once
  // since the decision script only starts after the base transcript is done).
  const [streamingAgent, setStreamingAgent] = useState<{ id: string; text: string } | null>(null);

  // Bumping this forces a fresh replay of the streaming timeline.
  const [replayToken, setReplayToken] = useState(0);

  // Play the base transcript on mount / replay / mode change. Fixed mode
  // short-circuits to "everything revealed" with no timers.
  //
  // `replayToken` is a load-bearing effect dependency: bumping it on the
  // Replay button tears down the current stream and re-runs this effect
  // from the start. Biome's dependency tracker sees `replayToken` is read
  // but not "used" and suggests dropping it, which would break the replay.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!streaming) {
      setBaseVisible(BASE_SCRIPT);
      setBaseDone(true);
      setStreamingAgent(null);
      return;
    }

    setBaseVisible([]);
    setBaseDone(false);
    setStreamingAgent(null);

    const controller = playScript(BASE_SCRIPT, {
      onUserOrChoice: (item) => {
        setBaseVisible((prev) => [...prev, item]);
      },
      onAgentStart: (item) => {
        setStreamingAgent({ id: item.id, text: '' });
      },
      onAgentUpdate: (partial) => {
        setStreamingAgent((prev) => (prev ? { ...prev, text: partial } : prev));
      },
      onAgentComplete: (item) => {
        setBaseVisible((prev) => [...prev, item]);
        setStreamingAgent(null);
      },
      onDone: () => setBaseDone(true),
    });
    return () => controller.cancel();
  }, [streaming, replayToken]);

  // Play the decision response once the user picks a ChoiceList option.
  // Only runs after the base transcript has finished so streaming never
  // overlaps.
  useEffect(() => {
    if (!decisionValue) {
      setDecisionVisible([]);
      return;
    }
    const decisionScript = buildDecisionScript(decisionValue);

    if (!streaming) {
      setDecisionVisible(decisionScript);
      return;
    }

    if (!baseDone) return;

    setDecisionVisible([]);
    const controller = playScript(decisionScript, {
      onUserOrChoice: (item) => {
        setDecisionVisible((prev) => [...prev, item]);
      },
      onAgentStart: (item) => {
        setStreamingAgent({ id: item.id, text: '' });
      },
      onAgentUpdate: (partial) => {
        setStreamingAgent((prev) => (prev ? { ...prev, text: partial } : prev));
      },
      onAgentComplete: (item) => {
        setDecisionVisible((prev) => [...prev, item]);
        setStreamingAgent(null);
      },
    });
    return () => controller.cancel();
  }, [streaming, baseDone, decisionValue]);

  const handleDecision = useCallback((value: string) => {
    setDecisionValue(value);
    Growl.addGrowlMessage({
      id: `chat-panel-decision-${Date.now()}`,
      title: 'Choice made',
      children: `"${DECISION_LABELS[value] ?? value}"`,
      emphasis: 'success',
      lifetime: 3500,
    });
  }, []);

  const handleReplay = useCallback(() => {
    setDecisionValue(null);
    setDecisionVisible([]);
    setStreamingAgent(null);
    setReplayToken((token) => token + 1);
  }, []);

  const handleSubmit = useCallback((text: string) => {
    setPending(true);
    Growl.addGrowlMessage({
      id: `chat-panel-submit-${Date.now()}`,
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
      id: `chat-panel-stop-${Date.now()}`,
      title: 'Stopped',
      children: 'Generation cancelled.',
      emphasis: 'info',
      lifetime: 3500,
    });
  }, []);

  const handleSuggestionsRequest = useCallback((query: string) => {
    const filtered = CHAT_SUGGESTIONS.filter((s) =>
      s.label.toLowerCase().includes(query.toLowerCase()),
    );
    setSuggestions(filtered);
  }, []);

  const handleSuggestionAccept = useCallback(() => {
    setSuggestions([]);
  }, []);

  const fileRef = useRef<HTMLInputElement>(null);
  const tokenPercent = 68;
  const tokenBudgetAria = `Token budget ${tokenPercent}% remaining`;

  const handleFloatingAttachFiles = useCallback((ev: ChangeEvent<HTMLInputElement>) => {
    const n = ev.target.files?.length ?? 0;
    Growl.addGrowlMessage({
      id: `chat-panel-files-${Date.now()}`,
      title: 'Files selected',
      children: `${n} file(s)`,
      emphasis: 'info',
      lifetime: 3500,
    });
    ev.target.value = '';
  }, []);

  const handleFloatingTokenBudget = useCallback(() => {
    Growl.addGrowlMessage({
      id: `chat-panel-token-${Date.now()}`,
      title: 'Token budget',
      children: 'Would open usage dialog (example).',
      emphasis: 'info',
      lifetime: 3500,
    });
  }, []);

  const handleFloatingMic = useCallback(() => {
    Growl.addGrowlMessage({
      id: `chat-panel-mic-${Date.now()}`,
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

  // Hide the ChoiceList once the user decides so the decision pair reads
  // as the chosen-path continuation rather than "here are options, and
  // also the answer".
  const renderedBase = useMemo(() => {
    if (!decisionValue) return baseVisible;
    return baseVisible.filter((item) => item.kind !== 'choice');
  }, [baseVisible, decisionValue]);

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
    <Box inlinePadding="lg" blockPadding="lg">
      <Growl closeLabel="Dismiss all" />
      <Button design="primary" text="Open Airo panel" onClick={() => setShow(true)} />
      <Panel
        aria-label="Airo"
        {...args}
        show={show}
        onClose={() => setShow(false)}
        expanded={expanded}
        onExpandedChange={setExpanded}
        footerChrome={floatingComposer ? 'floating' : undefined}
        header={
          <Panel.AiroHeader
            tabs={TABS}
            showSections={!expanded}
            activeTabId={activeTab}
            onTabChange={setActiveTab}
            onClose={() => setShow(false)}
            onExpandedToggle={() => setExpanded((v) => !v)}
            expanded={expanded}
          />
        }
        footer={
          floatingComposer ? (
            <FloatingFooter>{floatingPanelFooter}</FloatingFooter>
          ) : expanded ? undefined : (
            <PromptBox
              placeholder={'Ask a follow-up… try "help" or "email"'}
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
        <ChatLayout
          autoScroll="smart-bottom"
          header={
            expanded ? (
              <Panel.AiroHeader.Sections
                tabs={TABS}
                activeTabId={activeTab}
                onTabChange={setActiveTab}
              />
            ) : undefined
          }
          footer={
            floatingComposer ? undefined : expanded ? (
              <PromptBox
                placeholder={'Ask a follow-up… try "help" or "email"'}
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
          <Box inlinePadding="lg" blockPadding="md" orientation="vertical" gap="lg">
            {streaming && (
              <Box orientation="horizontal" gap="sm">
                <Button design="tertiary" size="small" text="Replay" onClick={handleReplay} />
              </Box>
            )}
            {renderedBase.map((item) => renderScriptItem(item, { onDecision: handleDecision }))}
            {decisionVisible.map((item) => renderScriptItem(item))}
            {streamingAgent !== null && (
              <AgentMessage key={streamingAgent.id} ariaLabel={AGENT_ARIA_LABEL}>
                {streamingAgent.text}
              </AgentMessage>
            )}
          </Box>
        </ChatLayout>
      </Panel>
    </Box>
  );
}

// ── Stories ───────────────────────────────────────────────────────────────

const autoOpenInStoryView = (context: { viewMode?: string }) => context.viewMode === 'story';

/**
 * A fully composed chat panel: Airo header with tab navigation, a
 * scrollable conversation built from `UserMessage` / `AgentMessage` (with
 * a `UserMessage.Gallery` attachment demo on the first user turn), a
 * `ChoiceList` decision prompt, and a typeahead `PromptBox` footer — all
 * wired together in a single `Panel` instance.
 *
 * **Try it:**
 * - Pick one of the three options in the `ChoiceList` to branch the
 *   conversation.
 * - Type in the footer field to trigger typeahead suggestions — try
 *   **"help"**, **"email"**, or **"can"**.
 * - Click a thumbnail in the first user turn to open the shared lightbox.
 * - Submit a follow-up prompt to see the pending / stop flow.
 * - Scroll the conversation body to watch the Airo header hide on
 *   scroll-down and reappear on scroll-up.
 */
export const FixedConversation: Story = {
  name: 'Fixed conversation',
  render: (args, context) => <ChatPanelDemo {...args} initialShow={autoOpenInStoryView(context)} />,
  parameters: {
    docs: {
      description: {
        story:
          'Static transcript — every turn, the ChoiceList, and the attachment gallery render immediately so the full surface composition is visible at a glance. Pick a ChoiceList option to branch; use the typeahead `PromptBox` in the footer to send a follow-up.',
      },
    },
  },
};

/**
 * The same composition as `FixedConversation`, but the conversation
 * replays progressively: user and choice turns appear one by one, and
 * agent responses stream their markdown token-by-token through the
 * `AgentMessage` polite live region — matching the behavior of a real
 * LLM streaming API. Click **Replay** above the conversation to re-run
 * the timeline from the start.
 *
 * **Try it:**
 * - Watch the first user turn (with its attachment gallery) pop in, then
 *   the agent response stream in markdown-aware chunks.
 * - Pick a `ChoiceList` option once the base transcript finishes — the
 *   decision pair streams in with the same cadence.
 * - Click **Replay** to restart the whole sequence from the top.
 */
export const StreamingConversation: Story = {
  name: 'Streaming conversation',
  render: (args, context) => (
    <ChatPanelDemo {...args} streaming initialShow={autoOpenInStoryView(context)} />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Approximates an LLM-backed chat replay: user turns reveal instantly, agent turns stream their markdown through `AgentMessage`'s polite live region, and the `ChoiceList` mounts after the last agent turn finishes. Click **Replay** at the top of the panel to re-run the timeline.",
      },
    },
  },
};

/**
 * Same transcript and typeahead behavior as **Fixed conversation**, but the
 * composer sits in **`Panel`’s footer** (`PanelChrome` sticky footer) as
 * **`FloatingFooter` + borderless `PromptBox`** with **`footerChrome="floating"`**
 * — transparent footer band (no footer shadow), no top gutter padding,
 * **`lg`** horizontal inset and **`md`** bottom inset. `ChatLayout` does not pass `footer`.
 */
export const FixedConversationFloatingComposer: Story = {
  name: 'Fixed conversation (floating composer)',
  render: (args, context) => (
    <ChatPanelDemo {...args} floatingComposer initialShow={autoOpenInStoryView(context)} />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Open the panel and use the floating borderless composer in the **panel footer** with **`footerChrome="floating"`**: typeahead matches **CHAT_SUGGESTIONS** (try **"help"**, **"email"**, **"can"**). Expand/collapse still works; the composer stays in **`Panel`’s footer** in both modes (not `ChatLayout`’s footer).',
      },
    },
  },
};

/**
 * Same streaming replay as **Streaming conversation**, with the **floating
 * borderless** composer in **`Panel`’s footer** and **`footerChrome="floating"`**.
 */
export const StreamingConversationFloatingComposer: Story = {
  name: 'Streaming conversation (floating composer)',
  render: (args, context) => (
    <ChatPanelDemo
      {...args}
      floatingComposer
      streaming
      initialShow={autoOpenInStoryView(context)}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Replay the scripted timeline; the borderless composer with typeahead stays in **`Panel`’s footer** with **`footerChrome="floating"`**.',
      },
    },
  },
};
