import type { Meta, StoryObj } from '@storybook/react-vite';
import AsyncIcon from '@ux/icon/async-icon.js';

import { Chiclet } from './Chiclet';
import './styles.css';

const meta: Meta<typeof Chiclet> = {
  title: 'Primitives/Chiclet',
  component: Chiclet,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Airo-branded pill-shaped trigger ("Ask Airo"). Wand icon + label inside a rounded surface ringed by an animated Airo-purple gradient border. Pure trigger — no persistent state; the filled "pressed" visual is wired to `:active` only.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Chiclet>;

export const Default: Story = {};

export const Small: Story = {
  args: {
    size: 'small',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Use `size="small"` when the chiclet sits inline with other small buttons (toolbars, compact action rows). Mirrors `@ux/button size="small"` padding (`density × 1` block × `density × 2` inline) and font-size (`--uxText--fontSize-1`, ~14px).',
      },
    },
  },
};

export const CustomLabel: Story = {
  args: {
    children: 'Try Airo',
  },
};

export const CustomIcon: Story = {
  args: {
    icon: <AsyncIcon icon="lightning" />,
    children: 'Boost with Airo',
  },
};

export const NoIcon: Story = {
  args: {
    icon: false,
    children: 'Ask Airo',
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
    children: 'Ask Airo',
  },
};

export const RTL: Story = {
  decorators: [
    (Story) => (
      <div dir="rtl">
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'Icon and label order flips automatically under `dir="rtl"` via CSS flexbox direction inheritance. No extra markup needed.',
      },
    },
  },
};
