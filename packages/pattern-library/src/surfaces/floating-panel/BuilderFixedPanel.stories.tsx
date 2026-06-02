import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import '@ux/growl/styles';
import AsyncIcon from '@ux/icon/async-icon.js';
import TextLockup from '@ux/text-lockup';
import {
  type CSSProperties,
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { AgentMessage } from '../../chat/agent-message';
import '../../chat/agent-message/styles.css';
import { ChatLayout } from '../../chat/chat-layout';
import '../../chat/chat-layout/styles.css';
import { Thinker } from '../../chat/thinker';
import '../../chat/thinker/styles.css';
import { UserMessage } from '../../chat/user-message';
import '../../chat/user-message/styles.css';
import { ChoiceList, ChoiceListItemContent } from '../../input/choice-list';
import '../../input/choice-list/styles.css';
import { CtaButton, type CtaButtonStatus } from '../../input/cta-button';
import '../../input/cta-button/styles.css';
import { PromptBox, TokenBudgetButton } from '../../input/prompt-box';
import '../../input/prompt-box/styles.css';
import { PromptStage } from '../../input/prompt-stage';
import '../../input/prompt-stage/styles.css';
import { SecretsForm } from '../../input/secrets-form';
import '../../input/secrets-form/styles.css';
import '../../primitives/thinking-indicator/styles.css';
import { BuilderChatFooter, DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS } from '../builder-chat-footer';
import '../builder-chat-footer/styles.css';
import { BuilderHeader, DEFAULT_BUILDER_SECTIONS } from '../builder-header';
import '../builder-header/styles.css';
import { Canvas } from '../canvas';
import '../canvas/styles.css';
import { FloatingFooter } from '../floating-footer';
import '../floating-footer/styles.css';
import '../panel-chrome/styles.css';
import type { FloatingPanelDockedTo } from './FloatingPanel';
import { FloatingPanel } from './index';
import './styles.css';

const meta: Meta<typeof FloatingPanel> = {
  title: 'Usage Examples / Builder / Fixed chat panel',
  component: FloatingPanel,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Builder-surface composition with a **fixed** (non-detachable) chat panel: literally the same panel design, scenarios, and composer as **Detachable chat panel**, but with `lockedDocked={true}` so the panel cannot snap off its dock. The drag-handle pill is suppressed; `resizableWhenDocked` still works so consumers can adjust the panel\'s width. Use this when the chat is a permanent fixture of the workspace rather than an opt-in floating tool. The right-hand `Canvas` and the scenario palette inside it are unchanged from the detachable variant — `Canvas.Status` still surfaces a "Working…" chip during real agent activity.',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof FloatingPanel>;

// ── Types ─────────────────────────────────────────────────────────────────

type ChatItem =
  | { kind: 'agent'; id: string; content: string }
  | { kind: 'user'; id: string; text: string }
  | { kind: 'rich'; id: string; chunks: string[]; complete: boolean };

// What the agent is currently presenting in the composer area.
// `headerKind` = content rendered in the PromptBox expansion (textarea stays usable).
// `swapKind` = content that replaces the entire PromptBox via PromptStage.
//   - 'choice' / 'secret' / 'auth' apply to either delivery mode.
//   - 'thinking' is header-only — an in-progress task with a checklist
//     of stages; the band shows the indicator + title.
type AgentInputKind = 'choice' | 'secret' | 'auth' | 'thinking';

interface ThinkingStep {
  id: string;
  label: string;
  complete: boolean;
}

const THINKING_STEPS_INITIAL: ThinkingStep[] = [
  { id: 'analyze', label: 'Analyzing your brand voice', complete: false },
  { id: 'draft', label: 'Drafting hero copy variants', complete: false },
  { id: 'refine', label: 'Refining for tone and length', complete: false },
];

// ── Static data ───────────────────────────────────────────────────────────

const CHOICE_OPTIONS = [
  { value: 'blog', label: 'Blog post', description: 'Long-form editorial content for your site' },
  {
    value: 'landing',
    label: 'Landing page',
    description: 'Focused conversion page for a campaign',
  },
  {
    value: 'email',
    label: 'Email campaign',
    description: 'Multi-touch drip or broadcast sequence',
  },
];

const RICH_CHUNKS = [
  '## Homepage Hero\n\n',
  '**Headline:** "Your business, powered by AI."\n\n',
  '**Subheadline:** "From first impression to loyal customer',
  ' — we help you grow smarter."\n\n',
  '**CTA:** "Get started free →"\n\n',
  '---\n\n',
  '### Why it works\n\n',
  "- Speaks directly to the visitor's pain point\n",
  '- Clear value proposition in under 10 words\n',
  '- Low-friction CTA with no commitment required\n',
];

const INITIAL_ITEMS: ChatItem[] = [
  {
    kind: 'agent',
    id: 'agent-welcome',
    content:
      "Hi! I'm your Airo agent. Use the **scenario cards** on the right to explore how different agent interactions look and behave inside the builder.",
  },
];

// ── Scenario card ─────────────────────────────────────────────────────────

interface ScenarioAction {
  label: string;
  onTrigger: () => void;
}

interface ScenarioCardProps {
  icon: string;
  label: string;
  description: string;
  disabled?: boolean;
  actions: ScenarioAction[];
}

function ScenarioCard({ icon, label, description, disabled, actions }: ScenarioCardProps) {
  return (
    <Box
      orientation="vertical"
      gap="sm"
      inlinePadding="md"
      blockPadding="md"
      elevation="raised"
      aria-disabled={disabled || undefined}
    >
      <TextLockup size="sm" title={label} icon={<AsyncIcon icon={icon} />}>
        {description}
      </TextLockup>
      <Box displayType="flex" orientation="horizontal" gap="sm" wrap>
        {actions.map((action) => (
          <Button
            key={action.label}
            design="secondary"
            size="small"
            text={action.label}
            disabled={disabled}
            onClick={action.onTrigger}
          />
        ))}
      </Box>
    </Box>
  );
}

// ── Main demo ─────────────────────────────────────────────────────────────

function BuilderFixedDemo() {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Fixed mode: the panel is always docked into the sidebar drop zone, so
  // we hold the dock target as state and pin it to `sidebarRef.current` once
  // the ref is available. The controlled `dockedTo` + `lockedDocked={true}`
  // pair means the user cannot snap the panel off its dock.
  const [dockedTo, setDockedTo] = useState<FloatingPanelDockedTo>(null);
  const [items, setItems] = useState<ChatItem[]>(INITIAL_ITEMS);
  const [pending, setPending] = useState(false);
  const [streamTargetId, setStreamTargetId] = useState<string | null>(null);
  const [streamQueue, setStreamQueue] = useState<string[]>([]);
  // What the agent is presenting in the composer area, split into two
  // delivery modes that can run independently:
  // - `headerKind`: content rendered in the PromptBox **expansion** — sits
  //   above the textarea but does NOT block the user from typing.
  // - `swapKind`: content that **replaces** the PromptBox via `PromptStage`
  //   (animated swap). Only one swap surface is active at a time.
  const [headerKind, setHeaderKind] = useState<AgentInputKind | null>(null);
  // The PromptBox header can be collapsed (showing just the title row) or
  // expanded (showing the full staged content). Independent of `headerKind`
  // so the staged content stays addressable until the user resolves it.
  const [headerExpanded, setHeaderExpanded] = useState(true);
  const [swapKind, setSwapKind] = useState<AgentInputKind | null>(null);
  // Per-step completion state for the in-progress thinking scenario;
  // advanced on a timer once `headerKind === 'thinking'`.
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>(THINKING_STEPS_INITIAL);
  // Manual `Canvas.Status` chip — independent of real agent activity, used
  // by the "Show a status pill" scenario to flash the chip with a chosen
  // label so the visual treatment can be inspected in isolation.
  const [statusChipLabel, setStatusChipLabel] = useState<string | null>(null);
  const statusChipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Auth CtaButton state — tracks the authentication flow status.
  const [authStatus, setAuthStatus] = useState<CtaButtonStatus>('pending');
  const [authErrorMessage, setAuthErrorMessage] = useState('');
  // Track which auth flow was triggered: 'success' always succeeds, 'failure' always fails
  const [authFlowType, setAuthFlowType] = useState<'success' | 'failure'>('success');
  const tokenPercent = 72;

  // Trigger buttons are disabled while the agent is busy with an async op
  // or while a swap surface is active (the user is mid-flow). Header
  // expansions do NOT block triggers — the user can keep iterating.
  const busy = pending || streamTargetId !== null || swapKind !== null;

  useLayoutEffect(() => {
    // Pin the panel into the sidebar drop zone as soon as the zone mounts.
    if (sidebarRef.current) {
      setDockedTo(sidebarRef.current);
    }
  }, []);

  // While `headerKind === 'thinking'`, advance one checklist step every
  // ~1.2 s. When all are complete, post a wrap-up agent message and
  // clear the header so the demo resets to idle.
  useEffect(() => {
    if (headerKind !== 'thinking') return;
    const nextIdx = thinkingSteps.findIndex((s) => !s.complete);
    if (nextIdx === -1) {
      const tid = setTimeout(() => {
        setHeaderKind(null);
        setHeaderExpanded(true);
        setThinkingSteps(THINKING_STEPS_INITIAL);
        setItems((prev) => [
          ...prev,
          {
            kind: 'agent',
            id: `agent-thinking-done-${Date.now()}`,
            content: 'Hero draft is ready. Want to review variants or jump straight into edits?',
          },
        ]);
      }, 600);
      return () => clearTimeout(tid);
    }
    const tid = setTimeout(() => {
      setThinkingSteps((prev) =>
        prev.map((s, i) => (i === nextIdx ? { ...s, complete: true } : s)),
      );
    }, 1200);
    return () => clearTimeout(tid);
  }, [headerKind, thinkingSteps]);

  // Drain one chunk from the queue on each render cycle
  useEffect(() => {
    if (!streamTargetId || streamQueue.length === 0) return;
    const tid = setTimeout(() => {
      const next = streamQueue[0];
      if (next === undefined) return;
      const rest = streamQueue.slice(1);
      setItems((prev) =>
        prev.map(
          (item): ChatItem =>
            item.id === streamTargetId && item.kind === 'rich'
              ? {
                  kind: 'rich',
                  id: item.id,
                  chunks: [...item.chunks, next],
                  complete: rest.length === 0,
                }
              : item,
        ),
      );
      setStreamQueue(rest);
      if (rest.length === 0) {
        setStreamTargetId(null);
      }
    }, 110);
    return () => clearTimeout(tid);
  }, [streamTargetId, streamQueue]);

  // ── Scenario triggers ──────────────────────────────────────────────────

  const triggerChoiceHeader = useCallback(() => {
    if (busy) return;
    setPending(true);
    setTimeout(() => {
      setItems((prev) => [
        ...prev,
        {
          kind: 'agent',
          id: `agent-pre-choice-${Date.now()}`,
          content:
            'What kind of content would you like to create first? Pick an option above — or keep typing if you want to describe it instead.',
        },
      ]);
      setPending(false);
      setSwapKind(null);
      setHeaderKind('choice');
      setHeaderExpanded(true);
    }, 700);
  }, [busy]);

  const triggerChoiceSwap = useCallback(() => {
    if (busy) return;
    setPending(true);
    setTimeout(() => {
      setItems((prev) => [
        ...prev,
        {
          kind: 'agent',
          id: `agent-pre-choice-swap-${Date.now()}`,
          content: 'What kind of content would you like to create first?',
        },
      ]);
      setPending(false);
      setHeaderKind(null);
      setSwapKind('choice');
    }, 700);
  }, [busy]);

  const triggerSecretHeader = useCallback(() => {
    if (busy) return;
    setPending(true);
    setTimeout(() => {
      setItems((prev) => [
        ...prev,
        {
          kind: 'agent',
          id: `agent-pre-secret-${Date.now()}`,
          content:
            "To connect your email platform, I'll need your API key. Drop it in above — or keep chatting if you have questions first.",
        },
      ]);
      setPending(false);
      setSwapKind(null);
      setHeaderKind('secret');
      setHeaderExpanded(true);
    }, 700);
  }, [busy]);

  const triggerSecretSwap = useCallback(() => {
    if (busy) return;
    setPending(true);
    setTimeout(() => {
      setItems((prev) => [
        ...prev,
        {
          kind: 'agent',
          id: `agent-pre-secret-swap-${Date.now()}`,
          content:
            "To connect your email platform, I'll need your API key. Enter it below — it'll be stored securely.",
        },
      ]);
      setPending(false);
      setHeaderKind(null);
      setSwapKind('secret');
    }, 700);
  }, [busy]);

  const triggerThinkingHeader = useCallback(() => {
    if (busy) return;
    setPending(true);
    setTimeout(() => {
      setItems((prev) => [
        ...prev,
        {
          kind: 'agent',
          id: `agent-pre-thinking-${Date.now()}`,
          content:
            "I'll get started on a hero draft — you can keep typing. I'll show progress in the composer header.",
        },
      ]);
      setPending(false);
      setSwapKind(null);
      setHeaderKind('thinking');
      setHeaderExpanded(true);
      setThinkingSteps(THINKING_STEPS_INITIAL);
    }, 700);
  }, [busy]);

  const triggerRich = useCallback(() => {
    if (busy) return;
    const id = `rich-${Date.now()}`;
    setPending(true);
    setTimeout(() => {
      setItems((prev) => [
        ...prev,
        {
          kind: 'agent',
          id: `agent-pre-rich-${Date.now()}`,
          content: "Here's a homepage hero draft based on your brand guidelines:",
        },
        { kind: 'rich', id, chunks: [], complete: false },
      ]);
      setPending(false);
      setStreamQueue([...RICH_CHUNKS]);
      setStreamTargetId(id);
    }, 700);
  }, [busy]);

  const triggerAuthSwapSuccess = useCallback(() => {
    if (busy) return;
    setPending(true);
    setTimeout(() => {
      setItems((prev) => [
        ...prev,
        {
          kind: 'agent',
          id: `agent-pre-auth-swap-${Date.now()}`,
          content:
            'To access your GoDaddy account, I need you to authenticate. Click below to open the authentication window.',
        },
      ]);
      setPending(false);
      setHeaderKind(null);
      setSwapKind('auth');
      setAuthStatus('pending');
      setAuthErrorMessage('');
      setAuthFlowType('success');
    }, 700);
  }, [busy]);

  const triggerAuthSwapFailure = useCallback(() => {
    if (busy) return;
    setPending(true);
    setTimeout(() => {
      setItems((prev) => [
        ...prev,
        {
          kind: 'agent',
          id: `agent-pre-auth-swap-${Date.now()}`,
          content:
            'To access your GoDaddy account, I need you to authenticate. Click below to open the authentication window.',
        },
      ]);
      setPending(false);
      setHeaderKind(null);
      setSwapKind('auth');
      setAuthStatus('pending');
      setAuthErrorMessage('');
      setAuthFlowType('failure');
    }, 700);
  }, [busy]);

  const handleAuthAction = useCallback(async () => {
    setAuthStatus('processing');
    setAuthErrorMessage('');

    // Simulate async authentication
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Use the flow type to determine success or failure
    const success = authFlowType === 'success';
    if (success) {
      setAuthStatus('success');
      // Dismiss widget and show success message
      setTimeout(() => {
        setSwapKind(null);
        setItems((prev) => [
          ...prev,
          {
            kind: 'agent',
            id: `agent-post-auth-${Date.now()}`,
            content: 'Authentication successful! I now have access to your account.',
          },
        ]);
      }, 1500);
    } else {
      setAuthStatus('error');
      setAuthErrorMessage('Authentication failed. Please try again.');
    }
  }, [authFlowType]);

  const handleAuthCancel = useCallback(() => {
    setSwapKind(null);
    setAuthStatus('pending');
    setAuthErrorMessage('');
    setItems((prev) => [
      ...prev,
      {
        kind: 'agent',
        id: `agent-auth-cancel-${Date.now()}`,
        content: 'Got it! Use the scenario cards to keep exploring, or keep chatting here.',
      },
    ]);
  }, []);

  const triggerStatusChip = useCallback((label: string) => {
    setStatusChipLabel(label);
    if (statusChipTimerRef.current) {
      clearTimeout(statusChipTimerRef.current);
    }
    statusChipTimerRef.current = setTimeout(() => {
      setStatusChipLabel(null);
      statusChipTimerRef.current = null;
    }, 2500);
  }, []);

  // Clean up the status-chip timer on unmount so a stale callback can't
  // fire setState after the demo is gone.
  useEffect(() => {
    return () => {
      if (statusChipTimerRef.current) clearTimeout(statusChipTimerRef.current);
    };
  }, []);

  // ── Expansion interactions ─────────────────────────────────────────────

  const handleChoiceDecision = useCallback((value: string) => {
    const opt = CHOICE_OPTIONS.find((o) => o.value === value);
    setHeaderKind(null);
    setSwapKind(null);
    setHeaderExpanded(true);
    setItems((prev) => [
      ...prev,
      { kind: 'user', id: `user-choice-${Date.now()}`, text: opt?.label ?? value },
      {
        kind: 'agent',
        id: `agent-post-choice-${Date.now()}`,
        content: `Perfect — let's build your **${opt?.label.toLowerCase() ?? value}** together.`,
      },
    ]);
  }, []);

  const handleSecretSubmit = useCallback(() => {
    setHeaderKind(null);
    setSwapKind(null);
    setHeaderExpanded(true);
    setItems((prev) => [
      ...prev,
      { kind: 'user', id: `user-secret-${Date.now()}`, text: '••••••••••••••••' },
      {
        kind: 'agent',
        id: `agent-post-secret-${Date.now()}`,
        content: "API key received and verified. You're all connected — ready to continue.",
      },
    ]);
  }, []);

  const handleSecretCancel = useCallback(() => {
    setHeaderKind(null);
    setSwapKind(null);
    setHeaderExpanded(true);
    setItems((prev) => [
      ...prev,
      {
        kind: 'agent',
        id: `agent-post-secret-cancel-${Date.now()}`,
        content: 'No problem — we can connect your platform later. What else can I help with?',
      },
    ]);
  }, []);

  // ── Chat submit ────────────────────────────────────────────────────────

  const handleSubmit = useCallback((text: string) => {
    setPending(true);
    setItems((prev) => [...prev, { kind: 'user', id: `user-msg-${Date.now()}`, text }]);
    setTimeout(() => {
      setItems((prev) => [
        ...prev,
        {
          kind: 'agent',
          id: `agent-reply-${Date.now()}`,
          content: 'Got it! Use the scenario cards to keep exploring, or keep chatting here.',
        },
      ]);
      setPending(false);
    }, 1100);
  }, []);

  const handleStop = useCallback(() => {
    setPending(false);
    setStreamTargetId(null);
    setStreamQueue([]);
    setItems((prev) =>
      prev.map(
        (item): ChatItem =>
          item.kind === 'rich' && !item.complete
            ? { kind: 'rich', id: item.id, chunks: item.chunks, complete: true }
            : item,
      ),
    );
  }, []);

  const handleAttach = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const n = e.target.files?.length ?? 0;
    Growl.addGrowlMessage({
      id: `builder-files-${Date.now()}`,
      title: 'Files staged',
      children: `${n} file(s) attached.`,
      emphasis: 'info',
      lifetime: 3500,
    });
    e.target.value = '';
  }, []);

  // ── Render helpers ────────────────────────────────────────────────────

  const renderItem = (item: ChatItem) => {
    switch (item.kind) {
      case 'user':
        return <UserMessage key={item.id}>{item.text}</UserMessage>;
      case 'agent':
        return <AgentMessage key={item.id}>{item.content}</AgentMessage>;
      case 'rich':
        if (item.chunks.length === 0) return null;
        return <AgentMessage key={item.id}>{item.chunks.join('')}</AgentMessage>;
    }
  };

  // ── Header-mode content: rendered inside the PromptBox expansion. The
  // textarea stays usable so the user can keep chatting alongside the
  // staged choice / secret form. ──────────────────────────────────────────
  const headerContent =
    headerKind === 'choice' ? (
      <ChoiceList
        ariaLabel="Choose a content type"
        title="What would you like to create?"
        onDecision={handleChoiceDecision}
      >
        {CHOICE_OPTIONS.map((opt) => (
          <ChoiceList.Item key={opt.value} value={opt.value}>
            <ChoiceListItemContent description={opt.label} />
          </ChoiceList.Item>
        ))}
      </ChoiceList>
    ) : headerKind === 'secret' ? (
      <SecretsForm
        variant="conversation"
        borderless
        eyebrow="New secret"
        label="EMAIL_API_KEY"
        helperText="Token from your provider's developer settings."
        placeholder="sk-••••••••••••••••"
        onSubmit={handleSecretSubmit}
        onClose={handleSecretCancel}
      />
    ) : headerKind === 'thinking' ? (
      <Thinker.Checklist>
        {thinkingSteps.map((step) => (
          <Thinker.ChecklistItem key={step.id} complete={step.complete}>
            {step.label}
          </Thinker.ChecklistItem>
        ))}
      </Thinker.Checklist>
    ) : null;

  // Title shown in the PromptBox header band. The secret variant gets a
  // `TextLockup` lockup with a lock icon + `emphasis="highlight"`,
  // wrapped with `data-partial="componentAiro"` so the Airo partial
  // theme tints the icon and text without affecting the rest of the
  // band chrome.
  const headerTitle: ReactNode =
    headerKind === 'choice' ? (
      'Choose a content type'
    ) : headerKind === 'secret' ? (
      <div data-partial="componentAiro">
        <TextLockup
          size="xs"
          compact
          emphasis="highlight"
          icon={<AsyncIcon icon="locked" />}
          title="New secret: EMAIL_API_KEY"
        />
      </div>
    ) : headerKind === 'thinking' ? (
      'Drafting your homepage hero'
    ) : null;

  // ── PromptBox composer (default `slotKey` for PromptStage) ───────────
  const promptBoxNode = (
    <PromptBox
      appearance="borderless"
      placeholder="Ask anything…"
      pending={pending}
      expanded={headerKind !== null && headerExpanded}
      expansionContent={headerContent}
      expansionTitle={headerTitle}
      expansionThinking={headerKind === 'thinking'}
      onExpandedChange={setHeaderExpanded}
      onSubmit={handleSubmit}
      onStop={handleStop}
      toolbarStart={
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
            aria-label={`Token budget ${tokenPercent}% remaining`}
            onPress={() =>
              Growl.addGrowlMessage({
                id: `builder-token-${Date.now()}`,
                title: 'Token budget',
                children: 'Would open usage dialog.',
                emphasis: 'info',
                lifetime: 3500,
              })
            }
          />
        </Box>
      }
      beforeSubmit={
        <span className="airo-input-prompt-box__mic">
          <Button
            design="tertiary"
            size="small"
            icon={<AsyncIcon icon="mic" />}
            aria-label="Voice input"
            type="button"
            onClick={() =>
              Growl.addGrowlMessage({
                id: `builder-mic-${Date.now()}`,
                title: 'Microphone',
                children: 'Dictation hook.',
                emphasis: 'info',
                lifetime: 3500,
              })
            }
          />
        </span>
      }
    />
  );

  // ── Swap-mode content: replaces the PromptBox entirely via PromptStage.
  // The animated transition (`slotKey` change) gives a clear signal that
  // the input modality just shifted. ────────────────────────────────────
  const swapNode =
    swapKind === 'choice' ? (
      <ChoiceList
        ariaLabel="Choose a content type"
        title="What would you like to create?"
        onDecision={handleChoiceDecision}
      >
        {CHOICE_OPTIONS.map((opt) => (
          <ChoiceList.Item key={opt.value} value={opt.value}>
            <ChoiceListItemContent description={opt.label} />
          </ChoiceList.Item>
        ))}
      </ChoiceList>
    ) : swapKind === 'secret' ? (
      <SecretsForm
        variant="composer"
        borderless
        eyebrow="New secret"
        label="EMAIL_API_KEY"
        helperText="Token from your provider's developer settings."
        placeholder="sk-••••••••••••••••"
        onSubmit={handleSecretSubmit}
        onClose={handleSecretCancel}
      />
    ) : swapKind === 'auth' ? (
      <CtaButton
        borderless
        icon={<AsyncIcon icon="user-locked" />}
        title="Authentication Required"
        description="This action requires GoDaddy OAuth permission for:"
        helperText="A popup window will open for secure authentication with GoDaddy"
        actionLabel="Authenticate with GoDaddy"
        status={authStatus}
        errorMessage={authErrorMessage}
        onAction={handleAuthAction}
        onClose={handleAuthCancel}
      />
    ) : (
      promptBoxNode
    );

  const slotKey = swapKind ?? 'prompt';

  // Composer (PromptBox / swap surface) lives inside the `FloatingFooter`
  // raised card. The chat sections row sits **below** the FloatingFooter on
  // the panel's transparent background — so when docked into a DropZone it
  // reads as part of the page canvas rather than the raised composer surface.
  const panelFooter = (
    <>
      <input ref={fileRef} type="file" hidden multiple onChange={handleAttach} />
      <FloatingFooter>
        <PromptStage slotKey={slotKey}>{swapNode}</PromptStage>
      </FloatingFooter>
      <BuilderChatFooter>
        <BuilderChatFooter.Sections
          sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
          defaultActiveSectionId="chat"
          collapseInactive
        />
      </BuilderChatFooter>
    </>
  );

  return (
    <Box
      displayType="flex"
      orientation="vertical"
      // Page-level surface for the builder demo: low-contrast box intents
      // (bg + paired fg + border) via the `@ux/tailwind-intents` shorthand so
      // scenario cards and the detachable chat panel (each on the standard
      // `box.backgroundColor`) read as content sitting on a page canvas.
      // The `gdai-cmp-` prefix matches `tailwind.config.js` `prefix` — every
      // generated utility carries it, including ones from `@ux/tailwind-intents`.
      // See `src/chat/AGENTS.md` "Composition hints" for chat-surface conventions.
      //
      // `height: 100vh` + `overflow: hidden` locks the page to the viewport
      // height so the panel and canvas fill exactly one screen. Content that
      // overflows scrolls inside the canvas's own scroll wrapper, not the page.
      className="gdai-cmp-intents-ux-boxLowContrast"
      style={{ height: '100vh', overflow: 'hidden' } as CSSProperties}
    >
      <Growl closeLabel="Dismiss all" />

      {/* Full-width app bar — always visible; spans both sidebar and canvas. */}
      <BuilderHeader
        leading={<BuilderHeader.Brand />}
        center={
          <BuilderHeader.Sections
            sections={DEFAULT_BUILDER_SECTIONS}
            defaultActiveSectionId="edit"
            collapseInactive
          />
        }
        trailing={
          <BuilderHeader.Actions
            onPublish={() =>
              Growl.addGrowlMessage({
                id: `builder-publish-${Date.now()}`,
                title: 'Publish',
                children: 'Would open the publish flow.',
                emphasis: 'info',
                lifetime: 3500,
              })
            }
            onShare={() =>
              Growl.addGrowlMessage({
                id: `builder-share-${Date.now()}`,
                title: 'Share',
                children: 'Would open the share dialog.',
                emphasis: 'info',
                lifetime: 3500,
              })
            }
            onRefresh={() =>
              Growl.addGrowlMessage({
                id: `builder-refresh-${Date.now()}`,
                title: 'Refresh',
                children: 'Would reload the workspace.',
                emphasis: 'info',
                lifetime: 3500,
              })
            }
            onUserClick={() =>
              Growl.addGrowlMessage({
                id: `builder-user-${Date.now()}`,
                title: 'User menu',
                children: 'Would open the account menu.',
                emphasis: 'info',
                lifetime: 3500,
              })
            }
          />
        }
      />

      <Box
        displayType="flex"
        orientation="horizontal"
        blockAlignChildren="start"
        // `paddingInlineEnd` (logical property, RTL-safe) gives the Canvas's
        // outside edge LG breathing room from the viewport edge. The chat
        // sidebar still hugs the leading edge — only the trailing side is
        // inset, so the layout reads as "workspace anchored to the chat
        // pane, with the canvas floating in the page surface beside it."
        style={{ flex: '1 1 0', minHeight: 0, paddingInlineEnd: '1.5rem' } as CSSProperties}
      >
        {/* Sidebar drop zone — FloatingPanel docks here */}
        <FloatingPanel.DropZone
          ref={sidebarRef}
          style={
            {
              '--airo-fp-drop-zone-width': 'min(22rem, 100vw)',
              alignSelf: 'stretch',
              height: '100%',
            } as CSSProperties
          }
        />

        {/* Main canvas — scenario trigger cards. The `Canvas` surface here
         * doubles as the in-builder demo of the new component: it frames the
         * scenario palette the same way it would frame an HTML site preview
         * in production, and the `Canvas.Status` chip surfaces whenever the
         * agent is actively producing content. The `header` slot is intentionally
         * left empty in this usage example — the demo reads as a real builder
         * workspace, not a documentation page. */}
        <Canvas
          aria-label="Agent scenarios"
          status={
            // Manual `Show a status pill` trigger takes precedence so consumers
            // can inspect the chip's visual treatment in isolation. Otherwise
            // show the chip during real agent activity (initial wait, active
            // streaming, or running thinking checklist). Skip during swap
            // states where the agent is waiting on the user — that isn't
            // "the agent is working", it's "the user is responding".
            statusChipLabel != null ? (
              <Canvas.Status label={statusChipLabel} />
            ) : pending || streamTargetId !== null || headerKind === 'thinking' ? (
              <Canvas.Status label="Working…" />
            ) : null
          }
          style={
            {
              flex: '1 1 auto',
              minInlineSize: 0,
              alignSelf: 'stretch',
            } as CSSProperties
          }
        >
          <Box orientation="vertical" gap="lg" inlinePadding="lg" blockPadding="lg">
            {/* Auto-fill grid — cards pack into as many columns as fit at
             * `min-inline-size: 16rem`, falling back to a single column on
             * narrower canvases. Replaces the previous fixed-width single
             * column so the palette reads as a grid of options. */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(16rem, 1fr))',
                gap: '1rem',
              }}
            >
              <ScenarioCard
                icon="checkmark"
                label="Present a ChoiceList"
                description="Two delivery modes. 'In header' expands above the PromptBox; 'Swap input' replaces it via PromptStage."
                disabled={busy}
                actions={[
                  { label: 'In header', onTrigger: triggerChoiceHeader },
                  { label: 'Swap input', onTrigger: triggerChoiceSwap },
                ]}
              />
              <ScenarioCard
                icon="alert"
                label="Collect a credential"
                description="Two delivery modes for a SecretsForm — expanded above the PromptBox, or swapped in via PromptStage."
                disabled={busy}
                actions={[
                  { label: 'In header', onTrigger: triggerSecretHeader },
                  { label: 'Swap input', onTrigger: triggerSecretSwap },
                ]}
              />
              <ScenarioCard
                icon="user-locked"
                label="Request authentication"
                description="CtaButton widget for external OAuth flows. Swaps in via PromptStage with interactive states: pending, processing, success, error."
                disabled={busy}
                actions={[
                  { label: 'Swap input (success)', onTrigger: triggerAuthSwapSuccess },
                  { label: 'Swap input (failure)', onTrigger: triggerAuthSwapFailure },
                ]}
              />
              <ScenarioCard
                icon="clock"
                label="Show an in-progress task"
                description="`expansionThinking` shows a `ThinkingIndicator` next to the title; the panel reveals a `Thinker.Checklist` of stages."
                disabled={busy}
                actions={[{ label: 'In header', onTrigger: triggerThinkingHeader }]}
              />
              <ScenarioCard
                icon="information"
                label="Stream rich content"
                description="The agent delivers a formatted draft in real time, progressively revealing markdown chunks in the conversation."
                disabled={busy}
                actions={[{ label: 'Trigger →', onTrigger: triggerRich }]}
              />
              <ScenarioCard
                icon="notification"
                label="Show a status pill"
                description="Flashes `Canvas.Status` for ~2.5 s with the chosen label so the chip's visual treatment can be inspected in isolation from real agent activity."
                actions={[
                  { label: 'Editing…', onTrigger: () => triggerStatusChip('Editing…') },
                  { label: 'Saving…', onTrigger: () => triggerStatusChip('Saving…') },
                  {
                    label: 'Generating preview…',
                    onTrigger: () => triggerStatusChip('Generating preview…'),
                  },
                ]}
              />
            </div>
          </Box>
        </Canvas>

        {/* Locked-docked panel — always pinned to `sidebarRef`. With
         * `lockedDocked={true}` the drag-handle pill is suppressed and the
         * drag-to-undock pointer gesture is not wired, so the user cannot
         * snap the panel off the dock. `resizableWhenDocked` (default true)
         * still works, so the panel's width is adjustable from the inner
         * edge handle. */}
        <FloatingPanel
          show
          aria-label="Airo"
          dropZones={[sidebarRef]}
          dockedTo={dockedTo}
          // No-op: with `lockedDocked={true}` the panel cannot reach the
          // undock path, so this callback exists only to satisfy the
          // controlled-mode contract.
          onUndock={() => {}}
          onDock={(target) => setDockedTo(target)}
          snapToEdges={false}
          lockedDocked
          footerChrome="floating"
          // No header band: `lockedDocked` removes the drag-handle pill, and
          // the page-level `BuilderHeader` already provides the title chrome.
          // `header={null}` collapses the whole header div away (vs. an empty
          // fragment, which would render an empty band that just adds padding).
          header={null}
          headerChrome="ghost"
          footer={
            <Box displayType="flex" orientation="vertical" gap="sm">
              {panelFooter}
            </Box>
          }
        >
          <ChatLayout autoScroll="smart-bottom" footer={undefined}>
            <Box inlinePadding="lg" blockPadding="md" orientation="vertical" gap="md">
              {items.map(renderItem)}
              {pending && <Thinker showAnimation label="Working…" ariaLabel="Agent is working" />}
            </Box>
          </ChatLayout>
        </FloatingPanel>
      </Box>
    </Box>
  );
}

// ── Story export ──────────────────────────────────────────────────────────

/**
 * Builder fixed workspace: literally the same panel design as **Builder split
 * workspace**, with `FloatingPanel.lockedDocked={true}` so the chat panel
 * cannot be detached from its drop zone. Same scenarios, same composer,
 * same `Canvas` surface — just no snap-off affordance.
 *
 * In the builder pattern, the `PromptBox` is a collapsible host — agent-driven
 * interactions expand out of the top of the composer rather than swapping it out:
 * - **ChoiceList** expands above the input field; selecting an option collapses it.
 * - **SecretsForm** expands above the field; submitting collapses it.
 * - **Streaming content** arrives as an `AgentMessage` in the conversation.
 *
 * **Try it:**
 * - Click **Present a ChoiceList** — select an option to collapse the expansion and
 *   continue the conversation.
 * - Click **Collect a credential** — type any value and press **Save key**.
 * - Click **Stream rich content** — watch the markdown draft arrive chunk by chunk.
 * - Drag the **inner edge of the panel** to resize the chat column — `resizableWhenDocked`
 *   still works; `lockedDocked` only suppresses detach.
 */
export const BuilderFixedWorkspace: Story = {
  name: 'Builder fixed workspace',
  render: () => <BuilderFixedDemo />,
  parameters: {
    docs: {
      description: {
        story:
          "Panel is permanently **docked** into the left `FloatingPanel.DropZone`. The drag-handle pill is suppressed so users cannot snap the panel off; `resizableWhenDocked` still works so the panel's width is adjustable.",
      },
    },
  },
};
