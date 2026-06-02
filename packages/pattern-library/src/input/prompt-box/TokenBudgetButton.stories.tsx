import type { Meta, StoryObj } from '@storybook/react-vite';
import { box } from '@ux/box';

import { TokenBudgetButton } from './index';
import './styles.css';

const meta: Meta<typeof TokenBudgetButton> = {
  title: 'Input / TokenBudgetButton',
  component: TokenBudgetButton,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
};

export default meta;

type Story = StoryObj<typeof TokenBudgetButton>;

export const Default: Story = {
  args: {
    percent: 72,
    'aria-label': 'Token budget 72% remaining',
    onPress: () => {},
  },
};

/**
 * `emphasis` recolors the active arc using the matching high-contrast feedback
 * intent. The donut shape, sizing, and stroke geometry are unchanged.
 */
export const Emphasis: Story = {
  render: () => (
    <box.div orientation="horizontal" gap="sm" wrap inlineAlignChildren="center">
      <TokenBudgetButton percent={72} aria-label="Token budget 72% remaining" onPress={() => {}} />
      <TokenBudgetButton
        percent={62}
        emphasis="highlight"
        aria-label="Token budget 62% remaining"
        onPress={() => {}}
      />
      <TokenBudgetButton
        percent={48}
        emphasis="info"
        aria-label="Token budget 48% remaining"
        onPress={() => {}}
      />
      <TokenBudgetButton
        percent={36}
        emphasis="success"
        aria-label="Token budget 36% remaining"
        onPress={() => {}}
      />
      <TokenBudgetButton
        percent={24}
        emphasis="warning"
        aria-label="Token budget 24% remaining"
        onPress={() => {}}
      />
      <TokenBudgetButton
        percent={8}
        emphasis="critical"
        aria-label="Token budget 8% remaining"
        onPress={() => {}}
      />
      <TokenBudgetButton
        percent={55}
        emphasis="neutral"
        aria-label="Token budget 55% remaining"
        onPress={() => {}}
      />
      <TokenBudgetButton
        percent={55}
        emphasis="internal"
        aria-label="Token budget 55% remaining"
        onPress={() => {}}
      />
      <TokenBudgetButton
        percent={55}
        emphasis="passive"
        aria-label="Token budget 55% remaining"
        onPress={() => {}}
      />
      <TokenBudgetButton
        percent={55}
        emphasis="premium"
        aria-label="Token budget 55% remaining"
        onPress={() => {}}
      />
    </box.div>
  ),
};
