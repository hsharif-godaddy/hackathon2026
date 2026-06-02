import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import Button from '@ux/button';
import Growl from '@ux/growl';
import '@ux/growl/styles';
import { useCallback, useState } from 'react';

import { ChoiceList, ChoiceListItem } from '../choice-list/index';
import '../choice-list/styles.css';
import { PromptBox } from '../prompt-box/index';
import '../prompt-box/styles.css';
import { PromptStage } from './index';
import './styles.css';

const meta: Meta<typeof PromptStage> = {
  title: 'Input / PromptStage',
  component: PromptStage,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          '`PromptStage` is a swap container for input surfaces. Change `slotKey` to animate between a `PromptBox`, a `ChoiceList`, a secrets form, or any other input widget. The outgoing widget slides up and fades out; the incoming widget slides up from below and fades in (`0.25s ease-out`, respects `prefers-reduced-motion`).',
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

type Story = StoryObj<typeof PromptStage>;

function announce(title: string, body: string, emphasis: 'success' | 'info' = 'success') {
  Growl.addGrowlMessage({
    id: `airo-prompt-stage-story-${Date.now()}`,
    title,
    children: body,
    emphasis,
    lifetime: 4000,
  });
}

/**
 * The most common agent pattern: the agent switches the input surface from
 * a free-text composer to a structured choice menu and back. Click the
 * buttons to swap between slots and watch the animation.
 */
export const PromptBoxAndChoiceList: Story = {
  name: 'PromptBox ↔ ChoiceList',
  render: () => {
    const [slotKey, setSlotKey] = useState<'prompt' | 'choices'>('prompt');

    const handleSubmit = useCallback((text: string) => {
      announce('Prompt submitted', `"${text}"`);
      setSlotKey('choices');
    }, []);

    const handleDecision = useCallback((value: string) => {
      announce('Choice selected', value);
      setSlotKey('prompt');
    }, []);

    return (
      <Box orientation="vertical" gap="md">
        <Box displayType="flex" orientation="horizontal" gap="sm">
          <Button
            design="secondary"
            size="small"
            text="→ PromptBox"
            onClick={() => setSlotKey('prompt')}
            disabled={slotKey === 'prompt'}
          />
          <Button
            design="secondary"
            size="small"
            text="→ ChoiceList"
            onClick={() => setSlotKey('choices')}
            disabled={slotKey === 'choices'}
          />
        </Box>
        <PromptStage slotKey={slotKey}>
          {slotKey === 'choices' ? (
            <ChoiceList
              title="What type of content do you want to create?"
              onDecision={handleDecision}
            >
              <ChoiceListItem value="blog">Blog post</ChoiceListItem>
              <ChoiceListItem value="landing">Landing page</ChoiceListItem>
              <ChoiceListItem value="email">Email campaign</ChoiceListItem>
            </ChoiceList>
          ) : (
            <PromptBox placeholder="Ask anything…" onSubmit={handleSubmit} />
          )}
        </PromptStage>
      </Box>
    );
  },
  parameters: {
    docs: {
      description: {
        story:
          'Submit the prompt to swap to the `ChoiceList`, then select an option to swap back. The animation plays on each swap.',
      },
    },
  },
};

/**
 * Static single-input view — no animation plays on first render. Use this
 * as a baseline to verify the stage doesn't add unexpected layout.
 */
export const StaticPromptBox: Story = {
  name: 'Static (no swap)',
  render: () => (
    <PromptStage slotKey="prompt">
      <PromptBox placeholder="Ask anything…" onSubmit={(t) => announce('Submitted', `"${t}"`)} />
    </PromptStage>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'No animation plays when `slotKey` is stable. The stage adds no visible layout change — it is invisible until the first swap.',
      },
    },
  },
};
