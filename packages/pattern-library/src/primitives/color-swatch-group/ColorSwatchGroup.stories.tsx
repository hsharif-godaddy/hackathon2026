import type { Meta, StoryObj } from '@storybook/react-vite';

import { ColorSwatchGroup } from './ColorSwatchGroup';
import '../color-swatch/styles.css';
import './styles.css';

const BRAND_PALETTE = [
  { color: '#E03B2F', name: 'Cayenne' },
  { color: '#2F5FE0', name: 'Royal' },
  { color: '#2FE05F', name: 'Emerald' },
  { color: '#E0C12F', name: 'Amber' },
  { color: '#8F2FE0', name: 'Violet' },
];

const meta: Meta<typeof ColorSwatchGroup> = {
  title: 'Primitives/ColorSwatchGroup',
  component: ColorSwatchGroup,
  tags: ['autodocs'],
  args: {
    swatches: BRAND_PALETTE,
    'aria-label': 'Brand palette',
  },
};

export default meta;
type Story = StoryObj<typeof ColorSwatchGroup>;

export const Default: Story = {};

export const Truncated: Story = {
  args: {
    swatches: [
      ...BRAND_PALETTE,
      { color: '#E07A2F', name: 'Orange' },
      { color: '#2FD6E0', name: 'Cyan' },
    ],
  },
};

export const SingleSwatch: Story = {
  args: {
    swatches: [{ color: '#E03B2F', name: 'Cayenne' }],
  },
};

export const CustomMax: Story = {
  args: {
    swatches: BRAND_PALETTE,
    max: 3,
  },
};

export const LargeSize: Story = {
  args: {
    size: 36,
  },
};

export const SmallSize: Story = {
  args: {
    size: 16,
  },
};
