import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import type { CSSProperties } from 'react';

import { BuilderChatFooter, DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS } from './BuilderChatFooter';
import './styles.css';

const meta: Meta<typeof BuilderChatFooter> = {
  title: 'Surfaces / BuilderChatFooter',
  component: BuilderChatFooter,
  tags: ['autodocs'],
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Centered band that sits below a chat composer. Single open content slot — the canonical default is `<BuilderChatFooter.Sections />` (chat / media / history / analytics / settings).',
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof BuilderChatFooter>;

/** Default footer with the canonical segmented-controller content. */
export const Default: Story = {
  render: () => (
    <Box
      displayType="flex"
      orientation="vertical"
      className="gdai-cmp-intents-ux-boxLowContrast"
      blockPadding="lg"
      inlinePadding="lg"
      style={{ minBlockSize: '12rem' } as CSSProperties}
    >
      <BuilderChatFooter>
        <BuilderChatFooter.Sections
          sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
          defaultActiveSectionId="chat"
        />
      </BuilderChatFooter>
    </Box>
  ),
};

/** Compact icon strip — inactive segments collapse to icon + tooltip. */
export const CollapseInactiveSections: Story = {
  render: () => (
    <Box
      displayType="flex"
      orientation="vertical"
      className="gdai-cmp-intents-ux-boxLowContrast"
      blockPadding="lg"
      inlinePadding="lg"
      style={{ minBlockSize: '12rem' } as CSSProperties}
    >
      <BuilderChatFooter>
        <BuilderChatFooter.Sections
          sections={DEFAULT_BUILDER_CHAT_FOOTER_SECTIONS}
          defaultActiveSectionId="chat"
          collapseInactive
        />
      </BuilderChatFooter>
    </Box>
  ),
};

/** Custom content — the slot is fully open. */
export const CustomContent: Story = {
  render: () => (
    <Box
      displayType="flex"
      orientation="vertical"
      className="gdai-cmp-intents-ux-boxLowContrast"
      blockPadding="lg"
      inlinePadding="lg"
      style={{ minBlockSize: '12rem' } as CSSProperties}
    >
      <BuilderChatFooter>
        <span>Anything you want here — buttons, status text, custom controls.</span>
      </BuilderChatFooter>
    </Box>
  ),
};
