import type { Meta, StoryObj } from '@storybook/react-vite';

import { ThinkingIndicator } from './ThinkingIndicator';
import './styles.css';

const meta: Meta<typeof ThinkingIndicator> = {
  title: 'Primitives/ThinkingIndicator',
  component: ThinkingIndicator,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Lightweight loading indicator with three variants — three staggered bouncing dots (default), a single rotating circular arc (`spinner`), and the GoDaddy brand mark with a happy bounce + brand-color breathing cycle (`godaddy`). Renders a `role="status"` live region so screen readers announce the label on mount.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof ThinkingIndicator>;

export const Default: Story = {};

export const WithLabel: Story = {
  args: {
    label: 'Generating a response',
  },
};

export const LargeSize: Story = {
  args: {
    size: 2,
    label: 'Loading',
  },
};

export const SmallSize: Story = {
  args: {
    size: 0.5,
    label: 'Loading',
  },
};

export const Spinner: Story = {
  args: {
    variant: 'spinner',
    label: 'Editing your site',
  },
  parameters: {
    docs: {
      description: {
        story:
          'The `spinner` variant renders a single rotating circular arc. Use it inside compact status pills (e.g. `Canvas.Status`) and dense surfaces where the three-dot motion would feel busy.',
      },
    },
  },
};

export const SpinnerCompact: Story = {
  args: {
    variant: 'spinner',
    size: 0.6,
    label: 'Editing your site',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Compact spinner at `size={0.6}`. Pill-embedding consumers typically pin the spinner to a fixed pixel size via the `--airo-primitives-thinking-indicator-dot-size` CSS custom property instead of the `size` prop.',
      },
    },
  },
};

export const GoDaddy: Story = {
  args: {
    variant: 'godaddy',
    label: 'Generating with AI',
  },
  parameters: {
    docs: {
      description: {
        story:
          'The `godaddy` variant renders the GoDaddy brand mark with a happy-bounce + brand-color breathing cycle. Reserve for hero "the AI is working on it" moments — the visual weight is heavier than the dots or spinner, so it competes inside a dense status row.',
      },
    },
  },
};

export const GoDaddyLarge: Story = {
  args: {
    variant: 'godaddy',
    size: 2,
    label: 'Generating with AI',
  },
  parameters: {
    docs: {
      description: {
        story:
          'GoDaddy variant at `size={2}` for hero placements. The bounce keyframes use `transform-origin: center bottom` so the mark plants on its baseline and reads as a jump rather than a wobble.',
      },
    },
  },
};
