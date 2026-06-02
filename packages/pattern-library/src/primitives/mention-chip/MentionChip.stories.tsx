import type { Meta, StoryObj } from '@storybook/react-vite';
import text from '@ux/text';

import { MentionChip } from './MentionChip';
import './styles.css';

const meta: Meta<typeof MentionChip> = {
  title: 'Primitives/MentionChip',
  component: MentionChip,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Inline chip primitive for "mention"-shaped references — a small interactive badge that points to a numbered entity in some host document tree. Designed to sit inline with body text or inside a contenteditable host (Lexical, Slate). Pure trigger — no persistent "selected" state.',
      },
    },
  },
  args: {
    prefix: 1,
    label: 'Button',
  },
};

export default meta;
type Story = StoryObj<typeof MentionChip>;

export const Default: Story = {
  args: {
    onActivate: () => {},
    onRemove: () => {},
  },
};

export const ReadOnly: Story = {
  args: {
    onActivate: () => {},
  },
  parameters: {
    docs: {
      description: {
        story:
          'Omit `onRemove` to render a read-only chip with no trailing ✕ button. Useful for static references that the user can navigate to but not delete from the surrounding text.',
      },
    },
  },
};

export const NoPrefix: Story = {
  args: {
    prefix: undefined,
    label: 'Pinned note',
    onActivate: () => {},
    onRemove: () => {},
  },
  parameters: {
    docs: {
      description: {
        story:
          'Omit `prefix` for a chip with just a label — useful when the reference does not have a stable number (e.g. a single pinned object).',
      },
    },
  },
};

export const RichLabel: Story = {
  args: {
    label: (
      <>
        <strong>Hero</strong> section
      </>
    ),
    onActivate: () => {},
    onRemove: () => {},
  },
  parameters: {
    docs: {
      description: {
        story:
          'The `label` prop accepts any `ReactNode` so you can render rich content (icons, formatted text). Keep the result short — the chip is meant to feel like punctuation.',
      },
    },
  },
};

export const InlineWithText: Story = {
  args: {
    onActivate: () => {},
    onRemove: () => {},
  },
  decorators: [
    (Story) => (
      <text.p style={{ maxWidth: '32ch' }}>
        Update the styles for <Story /> so the radius matches the design.
      </text.p>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'The chip is em-sized and uses `vertical-align: baseline` so it sits on the same baseline as surrounding body text without disrupting the line-height of the paragraph.',
      },
    },
  },
};

export const TranslatedRemoveLabel: Story = {
  args: {
    removeLabel: 'Quitar',
    onActivate: () => {},
    onRemove: () => {},
  },
  parameters: {
    docs: {
      description: {
        story:
          "Override the remove button's accessible name via `removeLabel` for translated copy or to disambiguate when many chips appear on the same page.",
      },
    },
  },
};

export const RTL: Story = {
  args: {
    onActivate: () => {},
    onRemove: () => {},
  },
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
          'Layout flows naturally under `dir="rtl"` via logical properties. The remove button stays at the trailing edge in both directions.',
      },
    },
  },
};
