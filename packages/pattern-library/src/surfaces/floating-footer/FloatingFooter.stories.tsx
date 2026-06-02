import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import '@ux/growl/styles';
import AsyncIcon from '@ux/icon/async-icon.js';
import { useCallback, useRef, useState } from 'react';

import { PromptBox, type PromptSuggestion, TokenBudgetButton } from '../../input/prompt-box';
import '../../input/prompt-box/styles.css';
import { FloatingFooter } from './index';
import './styles.css';

const meta: Meta<typeof FloatingFooter> = {
  title: 'Surfaces / FloatingFooter',
  component: FloatingFooter,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Raised-elevation bottom sheet built on `@ux/box elevation="raised"` — softer depth than overlay / modal chrome, suitable for drawer composers.',
      },
    },
  },
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

type Story = StoryObj<typeof FloatingFooter>;

/** Same mock list as **Input / PromptBox → With typeahead suggestions** (borderless flyout). */
const TYPEAHEAD_MOCKS: PromptSuggestion[] = [
  { id: 'sug-1', label: 'Help me write a landing page' },
  { id: 'sug-2', label: 'Help me write a blog post' },
  { id: 'sug-3', label: 'Help me set up email marketing' },
  { id: 'sug-4', label: 'Can you help me create a logo?' },
];

function announce(title: string, body: string, emphasis: 'success' | 'info' = 'success') {
  Growl.addGrowlMessage({
    id: `airo-floating-footer-story-${Date.now()}`,
    title,
    children: body,
    emphasis,
    lifetime: 4000,
  });
}

export const Default: Story = {
  render: () => (
    <Box orientation="vertical" gap="md" stretch className="max-w-md">
      <Box blockPadding="md" inlinePadding="md">
        Page content above the footer…
      </Box>
      <FloatingFooter>
        <Box orientation="horizontal" stretch blockAlignChildren="center" gap="md">
          <Button design="tertiary" size="small" text="Left" type="button" />
          <div aria-hidden className="min-w-0 flex-1" />
          <Button design="primary" size="small" text="Primary" type="button" />
        </Box>
      </FloatingFooter>
    </Box>
  ),
};

/**
 * Borderless `PromptBox` (field + attach / token / mic / send toolbar) inside
 * the floating footer capsule — typical drawer composer.
 */
export const BorderlessPromptBox: Story = {
  name: 'Borderless PromptBox',
  render: () => {
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
      <Box orientation="vertical" gap="md" stretch className="max-w-md">
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
        <Box blockPadding="md" inlinePadding="md">
          Page content above the composer…
        </Box>
        <FloatingFooter>
          <PromptBox
            appearance="borderless"
            placeholder="Message with attachments…"
            toolbarStart={toolbarStart}
            beforeSubmit={beforeSubmit}
            onSubmit={handleSubmit}
          />
        </FloatingFooter>
      </Box>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Import `@airo/components/surfaces/floating-footer/styles` and `@airo/components/input/prompt-box/styles`. Compose **`toolbarStart`** / **`beforeSubmit`** on `PromptBox` with `@ux/button` (attach, **`TokenBudgetButton`**, mic); Growl replaces a real dialog for the token action.',
      },
    },
  },
};

/**
 * Borderless `PromptBox` with typeahead — same interaction model as **Input /
 * PromptBox → Borderless + typeahead**, inside the floating capsule.
 */
export const BorderlessPromptBoxWithTypeahead: Story = {
  name: 'Borderless PromptBox + typeahead',
  render: () => {
    const fileRef = useRef<HTMLInputElement>(null);
    const tokenPercent = 68;
    const tokenBudgetAria = `Token budget ${tokenPercent}% remaining`;
    const [suggestions, setSuggestions] = useState<PromptSuggestion[]>([]);

    const handleSuggestionsRequest = useCallback((query: string) => {
      const filtered = TYPEAHEAD_MOCKS.filter((s) =>
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
      <Box orientation="vertical" gap="md" stretch className="max-w-md">
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
        <Box blockPadding="md" inlinePadding="md">
          Page content above the composer…
        </Box>
        <FloatingFooter>
          <PromptBox
            appearance="borderless"
            placeholder="Type 'help', 'can', or 'write' for suggestions…"
            toolbarStart={toolbarStart}
            beforeSubmit={beforeSubmit}
            suggestions={suggestions}
            onSuggestionsRequest={handleSuggestionsRequest}
            onSuggestionAccept={handleSuggestionAccept}
            onSubmit={handleSubmit}
          />
        </FloatingFooter>
      </Box>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Combines **Borderless PromptBox** with `suggestions` / `onSuggestionsRequest`. The flyout anchors to the borderless field; Growl echoes suggestion accept and submit.',
      },
    },
  },
};
