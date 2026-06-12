import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';

import { SecretsForm } from './index';
import './styles.css';

const meta: Meta<typeof SecretsForm> = {
  title: 'Input / SecretsForm',
  component: SecretsForm,
  tags: ['autodocs'],
  args: {
    onClose: () => {},
    submitLabel: 'Save',
  },
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Secret capture for one key at a time. Root **`@ux/box`**: **`elevation="raised"`** in **`variant="composer"`** (default; header **close (X)** always shown — **`onClose` is required**; icon send + helper in toolbar) and **`elevation="base"`** in **`variant="conversation"`** (Save + optional **Cancel** via **`onClose`**; helper under the field). Named stories cover **Default**, **CustomEyebrow**, **NoHelperText**, **WithValue**, **MaxLength**, **WithValidate**, **Pending**, **Interactive**, and **Conversation**.',
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 'min(calc(100vw - 2rem), 24rem)' }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof SecretsForm>;

export const Default: Story = {
  args: {
    label: 'DISCOGS_TOKEN:',
    helperText: 'Personal access token from discogs.com/settings/developers',
  },
};

export const CustomEyebrow: Story = {
  args: {
    eyebrow: 'Update Secret',
    label: 'OPENAI_API_KEY:',
    helperText: 'Your OpenAI API key from platform.openai.com',
  },
};

export const NoHelperText: Story = {
  args: {
    label: 'MY_SECRET:',
  },
};

export const WithValue: Story = {
  args: {
    label: 'DISCOGS_TOKEN:',
    helperText: 'Personal access token from discogs.com/settings/developers',
    value: 'example-token',
  },
};

export const MaxLength: Story = {
  args: {
    label: 'SHORT_CODE:',
    helperText: '4-character code from your device.',
    maxLength: 4,
    minLength: 4,
  },
};

export const WithValidate: Story = {
  args: {
    label: 'NUMERIC_PIN:',
    helperText: 'Digits only.',
    validate: (v) => (/^\d+$/.test(v) ? undefined : 'Use digits only.'),
  },
};

/** Submit disabled while the host reports an in-flight save (`pending`). */
export const Pending: Story = {
  args: {
    label: 'DISCOGS_TOKEN:',
    helperText: 'Personal access token from discogs.com/settings/developers',
    pending: true,
    value: 'example-pending-value',
  },
};

/** Types into the field and toggles show/hide (no submit — the form would dismiss). */
export const Interactive: Story = {
  args: {
    label: 'DISCOGS_TOKEN:',
    helperText: 'Personal access token from discogs.com/settings/developers',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText('Enter value');
    await userEvent.type(input, 'demo-secret');
    await userEvent.click(canvas.getByRole('button', { name: 'Show value' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Hide value' }));
  },
};

/** In-thread layout: narrow column like a chat bubble rail. */
export const Conversation: Story = {
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 360, marginInline: 'auto' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    variant: 'conversation',
    label: 'DISCOGS_TOKEN:',
    helperText: 'Personal access token from discogs.com/settings/developers',
    onClose: () => {},
  },
};
