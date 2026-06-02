import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import '@ux/growl/styles';
import AsyncIcon from '@ux/icon/async-icon.js';
import text from '@ux/text';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';

import { ChoiceList, ChoiceListItem } from '../choice-list/index';
import '../choice-list/styles.css';
import { PromptStage } from '../prompt-stage/index';
import '../prompt-stage/styles.css';
import { PromptBox, type PromptBoxHandle, type PromptSuggestion, TokenBudgetButton } from './index';
import './styles.css';

const meta: Meta<typeof PromptBox> = {
  title: 'Input / PromptBox',
  component: PromptBox,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '`PromptBox` always includes the built-in **send / stop** control. Compose optional **`beforeSubmit`** (e.g. mic next to send in the field frame) and, for `appearance="borderless"`, **`toolbarStart`** (e.g. attach + **`TokenBudgetButton`**) plus **`beforeSubmit`** — see **Borderless + toolbar** and **Default + microphone**. For a raised floating capsule around a borderless composer, wrap it in **`FloatingFooter`** (**Surfaces / FloatingFooter → Borderless PromptBox**). Typeahead suggestions use `suggestions` / `onSuggestionsRequest` — see **With typeahead suggestions** and **Borderless + typeahead**. Use **`TokenBudgetButton`** for the token donut control.',
      },
    },
  },
  argTypes: {
    pending: { control: 'boolean' },
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
    submitLabel: { control: 'text' },
    stopLabel: { control: 'text' },
  },
  // One shared Growl instance across all stories.
  decorators: [
    (Story) => (
      <>
        <Growl closeLabel="Dismiss all" />
        <Story />
      </>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof PromptBox>;

function announce(title: string, body: string, emphasis: 'success' | 'info' = 'success') {
  Growl.addGrowlMessage({
    id: `airo-prompt-box-story-${Date.now()}`,
    title,
    children: body,
    emphasis,
    lifetime: 4000,
  });
}

/**
 * The default idle state. Type a prompt and press Enter or click the
 * arrow button to submit. Shift+Enter inserts a new line.
 */
export const Default: Story = {
  args: {
    placeholder: 'Ask anything…',
  },
  render: (args) => {
    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
    }, []);

    return <PromptBox {...args} onSubmit={handleSubmit} />;
  },
};

/**
 * Shows the stop button state that appears while the AI is generating.
 * Click Stop to fire `onStop` and reset the field.
 */
export const Pending: Story = {
  name: 'Pending (stop button)',
  args: {
    placeholder: 'Ask anything…',
    pending: true,
  },
  render: (args) => {
    const [pending, setPending] = useState(args.pending ?? false);

    useEffect(() => {
      setPending(args.pending ?? false);
    }, [args.pending]);

    const handleSubmit = useCallback((text: string) => {
      announce('Generating…', `Prompt received: "${text}"`, 'info');
      setPending(true);
    }, []);

    const handleStop = useCallback(() => {
      announce('Stopped', 'Generation cancelled.', 'info');
      setPending(false);
    }, []);

    return (
      <PromptBox
        {...args}
        pending={pending}
        onSubmit={handleSubmit}
        onStop={handleStop}
        placeholder="Ask anything…"
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Submit a prompt to enter the pending state, then click the stop button (or use `onStop`) to cancel. The field resets on stop.',
      },
    },
  },
};

/**
 * Default frame: pass **`beforeSubmit`** with a tertiary mic `@ux/button`
 * (and any other trailing controls) before the built-in send.
 */
export const WithMicrophone: Story = {
  name: 'Default + microphone',
  args: {
    placeholder: 'Ask anything…',
  },
  render: (args) => {
    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
    }, []);

    return (
      <PromptBox
        {...args}
        onSubmit={handleSubmit}
        beforeSubmit={
          <span className="airo-input-prompt-box__mic">
            <Button
              design="tertiary"
              size="small"
              icon={<AsyncIcon icon="mic" />}
              aria-label="Voice input"
              type="button"
              onClick={() => announce('Microphone', 'Voice capture would start here.', 'info')}
            />
          </span>
        }
      />
    );
  },
};

/**
 * Full borderless toolbar: attach, token budget (donut on tertiary button), mic,
 * and built-in send — the recommended composition.
 */
export const BorderlessToolbar: Story = {
  name: 'Borderless + toolbar',
  render: (args) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const tokenPercent = 68;
    const tokenBudgetAria = `Token budget ${tokenPercent}% remaining`;
    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
    }, []);

    const toolbarStart = (
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
          onPress={() => announce('Token budget', 'Would open usage dialog (example).', 'info')}
        />
      </Box>
    );

    const beforeSubmit = (
      <span className="airo-input-prompt-box__mic">
        <Button
          design="tertiary"
          size="small"
          icon={<AsyncIcon icon="mic" />}
          aria-label="Voice input"
          type="button"
          onClick={() => announce('Microphone', 'Dictation hook', 'info')}
        />
      </span>
    );

    return (
      <>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const n = e.target.files?.length ?? 0;
            announce('Files selected', `${n} file(s)`, 'info');
            e.target.value = '';
          }}
        />
        <PromptBox
          {...args}
          appearance="borderless"
          placeholder="Message with attachments…"
          toolbarStart={toolbarStart}
          beforeSubmit={beforeSubmit}
          onSubmit={handleSubmit}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Attach opens a hidden `<input type="file" />`. Token budget uses **`TokenBudgetButton`** (Growl stands in for a dialog). For a raised **`FloatingFooter`** capsule, see **Surfaces / FloatingFooter → Borderless PromptBox**.',
      },
    },
  },
};

/**
 * Borderless composer with only the built-in send — no `toolbarStart` or `beforeSubmit`.
 */
export const BorderlessMinimal: Story = {
  name: 'Borderless (minimal)',
  render: (args) => {
    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
    }, []);

    return (
      <PromptBox {...args} appearance="borderless" placeholder="Message…" onSubmit={handleSubmit} />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Field + send only — add `toolbarStart` / `beforeSubmit` when you need attach, token, or mic.',
      },
    },
  },
};

/**
 * Mock suggestions returned by a fictional service after a short delay.
 *
 * Note the mix of starting words: most begin with "Help me…" but one begins
 * with "Can you help…". This exercises the inline-suggestion logic:
 * - Type "help" → all four appear; the first ("Help me write…") triggers
 *   the inline ghost because it starts with the typed text.
 * - Type "can" → only "Can you help…" appears; it starts with "can" so the
 *   ghost shows too.
 * - Type "write" → two matches appear, but neither starts with "write" so
 *   no inline ghost is shown — only the flyout list.
 */
const MOCK_SUGGESTIONS: PromptSuggestion[] = [
  { id: 'sug-1', label: 'Help me write a landing page' },
  { id: 'sug-2', label: 'Help me write a blog post' },
  { id: 'sug-3', label: 'Help me set up email marketing' },
  { id: 'sug-4', label: 'Can you help me create a logo?' },
];

/**
 * Demonstrates the typeahead suggestions popover and inline ghost completion.
 *
 * - Type **"help"** — four suggestions appear; the first ("Help me write a
 *   landing page") starts with the typed text so the inline ghost is shown.
 * - Type **"can"** — only "Can you help me create a logo?" matches; it starts
 *   with "can" so the ghost completes it inline.
 * - Type **"write"** — two suggestions match via substring but neither starts
 *   with "write", so the flyout list shows without any inline ghost.
 *
 * Arrow keys navigate the list; **Tab** accepts the first/active suggestion
 * for further editing; **Enter** on a highlighted item accepts it outright;
 * **Escape** dismisses the list.
 */
export const WithSuggestions: Story = {
  name: 'With typeahead suggestions',
  render: (args) => {
    const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);

    const handleSuggestionsRequest = useCallback((query: string) => {
      // Filter mock suggestions — in production this calls a real service.
      const filtered = MOCK_SUGGESTIONS.filter((s) =>
        s.label.toLowerCase().includes(query.toLowerCase()),
      );
      setSuggestions(filtered);
    }, []);

    const handleSuggestionAccept = useCallback(
      (suggestion: PromptSuggestion, mode: 'accept' | 'edit') => {
        announce(
          `Suggestion ${mode === 'edit' ? 'inserted for editing' : 'accepted'}`,
          `"${suggestion.label}"`,
          'info',
        );
        setSuggestions([]);
      },
      [],
    );

    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
      setSuggestions([]);
    }, []);

    return (
      <PromptBox
        {...args}
        placeholder="Type 'help', 'can', or 'write' to see suggestions…"
        suggestions={suggestions}
        onSuggestionsRequest={handleSuggestionsRequest}
        onSuggestionAccept={handleSuggestionAccept}
        onSubmit={handleSubmit}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Try **"help"** (ghost shown), **"can"** (ghost shown for "Can you help…"), or **"write"** (list only, no ghost — the matching suggestions don\'t start with "write"). Arrow keys navigate; **Tab** accepts the first/active suggestion for editing; **Enter** on a highlighted item accepts it; **Escape** dismisses.',
      },
    },
  },
};

/**
 * Borderless appearance with the same mock typeahead service as **With typeahead
 * suggestions**, plus attach / token / mic toolbar slots.
 */
export const BorderlessWithTypeahead: Story = {
  name: 'Borderless + typeahead',
  render: (args) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const tokenPercent = 68;
    const tokenBudgetAria = `Token budget ${tokenPercent}% remaining`;
    const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);

    const handleSuggestionsRequest = useCallback((query: string) => {
      const filtered = MOCK_SUGGESTIONS.filter((s) =>
        s.label.toLowerCase().includes(query.toLowerCase()),
      );
      setSuggestions(filtered);
    }, []);

    const handleSuggestionAccept = useCallback(
      (suggestion: PromptSuggestion, mode: 'accept' | 'edit') => {
        announce(
          `Suggestion ${mode === 'edit' ? 'inserted for editing' : 'accepted'}`,
          `"${suggestion.label}"`,
          'info',
        );
        setSuggestions([]);
      },
      [],
    );

    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
      setSuggestions([]);
    }, []);

    const toolbarStart = (
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
          onPress={() => announce('Token budget', 'Would open usage dialog (example).', 'info')}
        />
      </Box>
    );

    const beforeSubmit = (
      <span className="airo-input-prompt-box__mic">
        <Button
          design="tertiary"
          size="small"
          icon={<AsyncIcon icon="mic" />}
          aria-label="Voice input"
          type="button"
          onClick={() => announce('Microphone', 'Dictation hook', 'info')}
        />
      </span>
    );

    return (
      <>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const n = e.target.files?.length ?? 0;
            announce('Files selected', `${n} file(s)`, 'info');
            e.target.value = '';
          }}
        />
        <PromptBox
          {...args}
          appearance="borderless"
          placeholder="Type 'help', 'can', or 'write' for suggestions…"
          toolbarStart={toolbarStart}
          beforeSubmit={beforeSubmit}
          suggestions={suggestions}
          onSuggestionsRequest={handleSuggestionsRequest}
          onSuggestionAccept={handleSuggestionAccept}
          onSubmit={handleSubmit}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Same suggestion mock as **With typeahead suggestions**, with **Borderless + toolbar** chrome. The flyout anchors to the borderless field shell.',
      },
    },
  },
};

/**
 * The expansion panel reveals content (file previews, context chips, etc.)
 * above the textarea. `PromptBox` renders a chevron toggle automatically:
 * inside the band when an `expansionTitle` is set, otherwise as a corner
 * action floating over the panel content. Driving `expanded` from the
 * outside still works — see the **Controlled expansion** story below.
 */
export const WithExpansionArea: Story = {
  name: 'With expansion area',
  args: {
    placeholder: 'Ask anything…',
    expanded: false,
  },
  argTypes: {
    expanded: { control: 'boolean' },
  },
  render: (args) => {
    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
    }, []);

    return (
      <PromptBox
        {...args}
        expansionContent={
          <Box displayType="flex" orientation="horizontal" inlineAlignChildren="center" gap="sm">
            <Box displayType="flex" orientation="horizontal" inlineAlignChildren="center" gap="sm">
              <AsyncIcon icon="paperclip" />
              <text.span size={-1}>report-q2.pdf</text.span>
            </Box>
            <Box displayType="flex" orientation="horizontal" inlineAlignChildren="center" gap="sm">
              <AsyncIcon icon="paperclip" />
              <text.span size={-1}>logo-v2.png</text.span>
            </Box>
          </Box>
        }
        onSubmit={handleSubmit}
      />
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Toggle **expanded** in the controls panel to open/close the panel. Pass any `ReactNode` as `expansionContent` — file chips, attachment previews, context tags, etc.',
      },
    },
  },
};

/**
 * Borderless composer with the expansion area open — the standard
 * app builder composition.
 */
export const BorderlessWithExpansion: Story = {
  name: 'Borderless + expansion area',
  render: (args) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const tokenPercent = 68;
    const [expanded, setExpanded] = useState(true);
    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
      setExpanded(false);
    }, []);

    const toolbarStart = (
      <Box displayType="flex" orientation="horizontal" inlineAlignChildren="center">
        <span className="airo-input-prompt-box__attach">
          <Button
            design="tertiary"
            size="small"
            icon={<AsyncIcon icon="plus" />}
            aria-label="Attach files"
            type="button"
            onClick={() => {
              fileRef.current?.click();
              setExpanded(true);
            }}
          />
        </span>
        <TokenBudgetButton
          percent={tokenPercent}
          aria-label={`Token budget ${tokenPercent}% remaining`}
          onPress={() => announce('Token budget', 'Would open usage dialog.', 'info')}
        />
      </Box>
    );

    return (
      <>
        <input
          ref={fileRef}
          type="file"
          hidden
          multiple
          onChange={(e) => {
            const n = e.target.files?.length ?? 0;
            announce('Files selected', `${n} file(s) staged`, 'info');
            e.target.value = '';
          }}
        />
        <PromptBox
          {...args}
          appearance="borderless"
          placeholder="Ask about these files…"
          expanded={expanded}
          expansionContent={
            <Box displayType="flex" orientation="horizontal" inlineAlignChildren="center" gap="sm">
              <Box
                displayType="flex"
                orientation="horizontal"
                inlineAlignChildren="center"
                gap="sm"
              >
                <AsyncIcon icon="paperclip" />
                <text.span size={-1}>report-q2.pdf</text.span>
              </Box>
              <Box
                displayType="flex"
                orientation="horizontal"
                inlineAlignChildren="center"
                gap="sm"
              >
                <AsyncIcon icon="paperclip" />
                <text.span size={-1}>logo-v2.png</text.span>
              </Box>
            </Box>
          }
          toolbarStart={toolbarStart}
          beforeSubmit={
            <span className="airo-input-prompt-box__mic">
              <Button
                design="tertiary"
                size="small"
                icon={<AsyncIcon icon="mic" />}
                aria-label="Voice input"
                type="button"
                onClick={() => announce('Microphone', 'Dictation hook', 'info')}
              />
            </span>
          }
          onSubmit={handleSubmit}
        />
      </>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Full app-builder composition: borderless + toolbar + expansion panel. Click **Attach files** to simulate opening the expansion; submit collapses it.',
      },
    },
  },
};

/**
 * Disabled state — both the field and the button are inert.
 */
export const Disabled: Story = {
  args: {
    placeholder: 'Ask anything…',
    disabled: true,
    defaultValue: 'This field is disabled',
  },
  render: (args) => <PromptBox {...args} />,
};

// ─── Composition examples ────────────────────────────────────────────────────

type SlotKey = 'prompt' | 'choices';

interface StagedFile {
  id: string;
  name: string;
}

/**
 * Full builder-pattern composer: `PromptStage` hosts a borderless
 * `PromptBox` (with attach, token budget, and mic) alongside a `ChoiceList`.
 * Submit on `PromptBox` announces and swaps to `ChoiceList`; selecting a
 * `ChoiceList` option announces and swaps back. Files staged via the attach
 * button appear as chips in the expansion area above the composer.
 *
 * Builder-specific props: `appearance="borderless"`, `toolbarStart`, `beforeSubmit`,
 * `expanded`, `expansionContent`. These are rarely needed on Venture Home.
 */
export const BuilderComposer: Story = {
  name: 'Builder composer',
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [slotKey, setSlotKey] = useState<SlotKey>('prompt');
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const fileRef = useRef<HTMLInputElement>(null);

    const tokenPercent = 68;
    const tokenBudgetAria = `Token budget ${tokenPercent}% remaining`;

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
      setSlotKey('choices');
    }, []);

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const handleDecision = useCallback((value: string) => {
      const labels: Record<string, string> = {
        blog: 'Blog post',
        landing: 'Landing page',
        email: 'Email campaign',
      };
      announce('Option selected', labels[value] ?? value, 'info');
      setSlotKey('prompt');
    }, []);

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      const next: StagedFile[] = files.map((f) => ({
        id: `${Date.now()}-${f.name}`,
        name: f.name,
      }));
      setStagedFiles((prev) => [...prev, ...next]);
      announce('Files staged', `${files.length} file(s) added.`, 'info');
      e.target.value = '';
    }, []);

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const removeFile = useCallback((id: string) => {
      setStagedFiles((prev) => prev.filter((f) => f.id !== id));
    }, []);

    const toolbarStart = (
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
          onPress={() => announce('Token budget', 'Would open usage dialog.', 'info')}
        />
      </Box>
    );

    const beforeSubmit = (
      <span className="airo-input-prompt-box__mic">
        <Button
          design="tertiary"
          size="small"
          icon={<AsyncIcon icon="mic" />}
          aria-label="Voice input"
          type="button"
          onClick={() => announce('Microphone', 'Dictation hook', 'info')}
        />
      </span>
    );

    const expansionContent =
      stagedFiles.length > 0 ? (
        <Box
          displayType="flex"
          orientation="horizontal"
          inlineAlignChildren="center"
          gap="sm"
          className="airo-input-prompt-box__staged-files"
        >
          {stagedFiles.map((f) => (
            <span key={f.id} className="airo-input-prompt-box__staged-chip">
              <span className="airo-input-prompt-box__staged-chip-name">{f.name}</span>
              <Button
                design="stateless"
                size="small"
                icon={<AsyncIcon icon="x" />}
                aria-label={`Remove ${f.name}`}
                type="button"
                onClick={() => removeFile(f.id)}
              />
            </span>
          ))}
        </Box>
      ) : null;

    return (
      <>
        <input ref={fileRef} type="file" hidden multiple onChange={handleFileChange} />
        <PromptStage slotKey={slotKey}>
          {slotKey === 'choices' ? (
            <ChoiceList
              ariaLabel="Choose a content type"
              title="What would you like to create?"
              onDecision={handleDecision}
            >
              <ChoiceListItem value="blog">Blog post</ChoiceListItem>
              <ChoiceListItem value="landing">Landing page</ChoiceListItem>
              <ChoiceListItem value="email">Email campaign</ChoiceListItem>
            </ChoiceList>
          ) : (
            <PromptBox
              appearance="borderless"
              placeholder="What do you want to create?"
              toolbarStart={toolbarStart}
              beforeSubmit={beforeSubmit}
              expanded={stagedFiles.length > 0}
              expansionContent={expansionContent}
              onSubmit={handleSubmit}
            />
          )}
        </PromptStage>
      </>
    );
  },
};

/**
 * Venture Home composer: default `appearance` (FieldFrame border), no toolbar,
 * single `onSubmit` handler. Contrast with **Builder composer** which uses
 * `appearance="borderless"` plus the full attach / token / mic toolbar.
 */
export const VentureHomeComposer: Story = {
  name: 'Venture Home composer',
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
    }, []);
    return <PromptBox placeholder="What do you want to build today?" onSubmit={handleSubmit} />;
  },
};

/**
 * Cross-component number-key shortcuts: a `PromptBox` sits next to a
 * `ChoiceList`, and pressing `1`–`9` while typing in the editor jumps focus
 * into the corresponding option. Wire up by pointing
 * `numberKeyShortcuts.scope` at a DOM element wrapping the `PromptBox` and
 * switching the listener to `document` so the keystroke is heard outside
 * the ChoiceList.
 */
export const WithChoiceListNumberKeys: Story = {
  name: 'With ChoiceList number-key shortcuts',
  parameters: {
    docs: {
      description: {
        story:
          'Shows the cross-component pattern. Type into the **PromptBox**, then press **`1`**, **`2`**, or **`3`** to focus the matching **ChoiceList** option. **Enter** still commits inside the list. Number keys typed elsewhere on the page are ignored because the listener is **`scope`**-bound to a wrapper around the **PromptBox**.',
      },
    },
  },
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const promptBoxScopeRef = useRef<HTMLDivElement>(null);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [selected, setSelected] = useState<string | null>(null);

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const handleSubmit = useCallback((value: string) => {
      announce('Prompt submitted', `"${value}"`);
    }, []);

    // eslint-disable-next-line react-hooks/rules-of-hooks
    const handleDecision = useCallback((value: string) => {
      const labels: Record<string, string> = {
        blog: 'Blog post',
        landing: 'Landing page',
        email: 'Email campaign',
      };
      announce('Option selected', labels[value] ?? value, 'info');
      setSelected(value);
    }, []);

    return (
      <Box orientation="vertical" gap="md">
        <ChoiceList
          ariaLabel="Choose a content type"
          title="What would you like to create?"
          numberKeyShortcuts={{ listenOn: 'document', scope: promptBoxScopeRef }}
          onDecision={handleDecision}
        >
          <ChoiceListItem value="blog">Blog post</ChoiceListItem>
          <ChoiceListItem value="landing">Landing page</ChoiceListItem>
          <ChoiceListItem value="email">Email campaign</ChoiceListItem>
        </ChoiceList>
        <div ref={promptBoxScopeRef}>
          <PromptBox
            placeholder="Describe what you want, or press 1/2/3 to jump to a choice…"
            onSubmit={handleSubmit}
          />
        </div>
        {selected ? (
          <text.span size={-1}>
            Last selection: <strong>{selected}</strong>
          </text.span>
        ) : null}
      </Box>
    );
  },
};

/**
 * Streaming state — `pending={true}` swaps the send button for stop and
 * routes Enter to the stop affordance. Click stop or Submit anew when the
 * model finishes streaming.
 */
export const Streaming: Story = {
  name: 'Streaming (pending + onStop)',
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [pending, setPending] = useState(false);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const handleSubmit = useCallback((textValue: string) => {
      announce('Streaming…', `Model would stream a response to: "${textValue}"`, 'info');
      setPending(true);
    }, []);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const handleStop = useCallback(() => {
      announce('Stopped', 'Stream cancelled.', 'info');
      setPending(false);
    }, []);
    return (
      <PromptBox
        placeholder="Ask anything…"
        pending={pending}
        onSubmit={handleSubmit}
        onStop={handleStop}
      />
    );
  },
};

/**
 * Listening state — the editor surface goes read-only while a speech-to-text
 * recognizer writes into the field via the controlled `value` prop. The user
 * can't simultaneously type or paste, but the chrome stays active so they
 * can still stop the recognizer or submit when ready.
 */
export const Listening: Story = {
  name: 'Listening (read-only transcript)',
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [listening, setListening] = useState(false);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [val, setVal] = useState('');
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      if (!listening) return;
      const phrases = [
        'Tell me ',
        'Tell me about ',
        'Tell me about the latest ',
        'Tell me about the latest design system ',
        'Tell me about the latest design system updates.',
      ];
      let idx = 0;
      const id = setInterval(() => {
        setVal(phrases[idx] ?? '');
        idx += 1;
        if (idx >= phrases.length) {
          clearInterval(id);
          setListening(false);
        }
      }, 600);
      return () => clearInterval(id);
    }, [listening]);

    return (
      <PromptBox
        placeholder="Tap mic to dictate…"
        value={val}
        onChange={setVal}
        isListening={listening}
        beforeSubmit={
          <span className="airo-input-prompt-box__mic">
            <Button
              design="tertiary"
              size="small"
              icon={<AsyncIcon icon={listening ? 'pause' : 'mic'} />}
              aria-label={listening ? 'Stop dictation' : 'Start dictation'}
              type="button"
              onClick={() => {
                setVal('');
                setListening((current) => !current);
              }}
            />
          </span>
        }
        onSubmit={(text) => {
          announce('Prompt submitted', `"${text}"`);
          setVal('');
        }}
      />
    );
  },
};

/**
 * Element-mention insertion — drive `PromptBoxHandle.insertElementMention()`
 * from external selection state to anchor the prompt to a specific page
 * element. Clicking the badge fires a `scroll-to-mention` document event;
 * the ✕ removes the badge and fires `onMentionRemoved`.
 */
export const MentionInsertion: Story = {
  name: 'Element mentions',
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const ref = useRef<PromptBoxHandle>(null);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [counter, setCounter] = useState(1);
    return (
      <Box displayType="flex" orientation="vertical" blockAlignChildren="start">
        <Box displayType="flex" orientation="horizontal">
          <Button
            design="secondary"
            size="small"
            type="button"
            onClick={() => {
              ref.current?.insertElementMention(counter, 'h1');
              setCounter((n) => n + 1);
            }}
          >
            Insert title mention
          </Button>
          <Button
            design="secondary"
            size="small"
            type="button"
            onClick={() => {
              ref.current?.insertElementMention(counter, 'button');
              setCounter((n) => n + 1);
            }}
          >
            Insert button mention
          </Button>
          <Button
            design="tertiary"
            size="small"
            type="button"
            onClick={() => ref.current?.clearAllElementMentions()}
          >
            Clear all
          </Button>
        </Box>
        <PromptBox
          ref={ref}
          placeholder="Insert mentions, then describe the change…"
          onSubmit={(textValue) => announce('Prompt submitted', `"${textValue}"`)}
          onMentionRemoved={(num) =>
            announce('Mention removed', `#${num} was deleted from the prompt.`, 'info')
          }
        />
      </Box>
    );
  },
};

/**
 * Paste handling — large text routes to `onLargePasteDetected` once it
 * crosses `maxInlinePasteLength`, files route to `onStageFiles` (gated on
 * `canStageFiles`), and pasted images route to `onScreenshotCaptured` as
 * resized JPEG data URLs (gated on `canAddAsset`).
 */
export const PasteHandling: Story = {
  name: 'Paste handling',
  render: () => {
    return (
      <PromptBox
        placeholder="Paste a long document, a file, or a screenshot…"
        canStageFiles
        canAddAsset
        maxInlinePasteLength={500}
        onLargePasteDetected={(content) =>
          announce(
            'Large paste staged',
            `${content.length} characters would be moved to an attachment.`,
            'info',
          )
        }
        onStageFiles={(files) =>
          announce('Files staged', files.map((f) => f.name).join(', ') || 'No files', 'info')
        }
        onScreenshotCaptured={() =>
          announce(
            'Screenshot captured',
            'Image resized to ≤ 1024px and forwarded to the host.',
            'info',
          )
        }
        onSubmit={(textValue) => announce('Prompt submitted', `"${textValue}"`)}
      />
    );
  },
};
