import type { Meta, StoryObj } from '@storybook/react-vite';
import { box } from '@ux/box';

import { ColorSwatch } from './ColorSwatch';
import './styles.css';

const meta: Meta<typeof ColorSwatch> = {
  title: 'Primitives/ColorSwatch',
  component: ColorSwatch,
  tags: ['autodocs'],
  args: {
    color: { color: '#E03B2F', name: 'Cayenne' },
  },
};

export default meta;
type Story = StoryObj<typeof ColorSwatch>;

export const Default: Story = {};

export const WithoutName: Story = {
  args: {
    color: { color: '#2F5FE0' },
  },
};

export const LargeSize: Story = {
  args: {
    color: { color: '#2FE05F', name: 'Emerald' },
    size: 40,
  },
};

export const SmallSize: Story = {
  args: {
    color: { color: '#8F2FE0', name: 'Violet' },
    size: 16,
  },
};

export const LightColorOnLightSurface: Story = {
  name: 'Light color on light surface (ring visibility)',
  args: {
    color: { color: '#ffffff', name: 'White' },
  },
};

export const InlineWithText: Story = {
  render: () => (
    <box.span orientation="horizontal" gap="sm" inlineAlignChildren="center">
      <ColorSwatch color={{ color: '#E03B2F', name: 'Cayenne' }} />
      <span>Cayenne</span>
    </box.span>
  ),
};
