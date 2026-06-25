import type { Meta, StoryObj } from '@storybook/react-vite';
import AsyncIcon from '@ux/icon/async-icon.js';

import { ActionCard } from './index';
import './styles.css';

const meta: Meta<typeof ActionCard> = {
  title: 'Primitives / ActionCard',
  component: ActionCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A tile stacking an icon over a title — the quick-action card used in command palettes, empty states, and action grids. Bound to the `actionControl` intent family; renders a real `<button>`; `active` is a purely visual highlight (drive it from a parent’s roving focus).',
      },
    },
  },
  args: {
    icon: <AsyncIcon icon="attachment" />,
    title: 'Attach',
  },
};

export default meta;
type Story = StoryObj<typeof ActionCard>;

/** Default tile. Cards stretch to fill their container — the story frame caps the width. */
export const Default: Story = {
  render: (args) => (
    <div style={{ inlineSize: '12rem' }}>
      <ActionCard {...args} />
    </div>
  ),
};

/** `active` highlight — what a parent list applies to the roving-focus candidate. */
export const Active: Story = {
  args: { active: true },
  render: Default.render,
};

/** Disabled — dimmed, non-interactive, no hover highlight. */
export const Disabled: Story = {
  args: { disabled: true },
  render: Default.render,
};

/** A row of three equal-width cards, the canonical command-palette layout. */
export const Row: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '0.75rem', inlineSize: '24rem' }}>
      <ActionCard icon={<AsyncIcon icon="attachment" />} title="Attach" />
      <ActionCard icon={<AsyncIcon icon="camera" />} title="Screenshot" />
      <ActionCard icon={<AsyncIcon icon="page" />} title="Reference a file" />
    </div>
  ),
};
