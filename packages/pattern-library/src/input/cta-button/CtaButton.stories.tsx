import type { Meta, StoryObj } from '@storybook/react-vite';
import Box from '@ux/box';
import AsyncIcon from '@ux/icon/async-icon.js';
import { useState } from 'react';
import { userEvent, within } from 'storybook/test';

import { CtaButton, type CtaButtonStatus } from './index';
import './styles.css';

const meta: Meta<typeof CtaButton> = {
  title: 'Input / CtaButton',
  component: CtaButton,
  tags: ['autodocs'],
  args: {
    onClose: () => {},
  },
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Call-to-action widget that replaces the chat input when an AI agent requires an external action (e.g., OAuth authentication, approval). Supports multiple states: **pending**, **processing**, **success**, and **error** with retry. Root **`@ux/box`**: **`elevation="raised"`** (default). Named stories cover **Default**, **AuthenticationPrompt**, **Processing**, **Success**, **Error**, **Borderless**, and **Interactive**.',
      },
    },
  },
  decorators: [
    (Story) => (
      <Box
        style={{
          width: 'min(calc(100vw - var(--ux-box-density)), calc(var(--ux-box-density) * 30))',
        }}
      >
        <Story />
      </Box>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof CtaButton>;

export const Default: Story = {
  args: {
    icon: <AsyncIcon icon="shield-check" />,
    title: 'Action Required',
    description: 'This action requires your confirmation to proceed.',
    helperText: 'Click the button below to continue.',
    actionLabel: 'Continue',
  },
};

export const AuthenticationPrompt: Story = {
  args: {
    icon: <AsyncIcon icon="user-locked" />,
    title: 'Authentication Required',
    description: 'This action requires GoDaddy OAuth permission for:',
    helperText: 'A popup window will open for secure authentication with GoDaddy',
    actionLabel: 'Authenticate with GoDaddy',
  },
};

export const Processing: Story = {
  args: {
    icon: <AsyncIcon icon="user-locked" />,
    title: 'Authentication Required',
    description: 'This action requires GoDaddy OAuth permission for:',
    helperText: 'A popup window will open for secure authentication with GoDaddy',
    actionLabel: 'Authenticate with GoDaddy',
    status: 'processing',
  },
};

export const Success: Story = {
  args: {
    icon: <AsyncIcon icon="user-locked" />,
    title: 'Authentication Required',
    description: 'This action requires GoDaddy OAuth permission for:',
    actionLabel: 'Authenticate with GoDaddy',
    status: 'success',
    successMessage: 'Authentication successful',
  },
};

export const ErrorState: Story = {
  args: {
    icon: <AsyncIcon icon="user-locked" />,
    title: 'Authentication Required',
    description: 'This action requires GoDaddy OAuth permission for:',
    actionLabel: 'Authenticate with GoDaddy',
    status: 'error',
    errorMessage: 'Authentication failed. Please try again.',
  },
};

export const NoHelperText: Story = {
  args: {
    icon: <AsyncIcon icon="external-link" />,
    title: 'External Action Required',
    description: 'Continue in the new window to complete this step.',
    actionLabel: 'Open Window',
  },
};

export const CustomLabels: Story = {
  args: {
    icon: <AsyncIcon icon="check-circle" />,
    title: 'Approval Needed',
    description: 'This action requires your approval.',
    helperText: 'Review the details before approving.',
    actionLabel: 'Approve',
    closeLabel: 'Dismiss',
    retryLabel: 'Retry Approval',
    cancelLabel: 'Decline',
  },
};

export const Borderless: Story = {
  args: {
    icon: <AsyncIcon icon="user-locked" />,
    title: 'Authentication Required',
    description: 'This action requires GoDaddy OAuth permission for:',
    helperText: 'A popup window will open for secure authentication with GoDaddy',
    actionLabel: 'Authenticate with GoDaddy',
    borderless: true,
  },
  decorators: [
    (Story) => (
      <Box
        elevation="base"
        inlinePadding="lg"
        blockPadding="lg"
        style={{
          width: 'min(calc(100vw - var(--ux-box-density)), calc(var(--ux-box-density) * 30))',
        }}
      >
        <Story />
      </Box>
    ),
  ],
};

/** Click the action button to simulate async processing → success flow. */
export const Interactive: Story = {
  render: (args) => {
    const [status, setStatus] = useState<CtaButtonStatus>('pending');

    return (
      <CtaButton
        {...args}
        status={status}
        onAction={async () => {
          setStatus('processing');
          await new Promise((resolve) => setTimeout(resolve, 1500));
          setStatus('success');
        }}
      />
    );
  },
  args: {
    icon: <AsyncIcon icon="user-locked" />,
    title: 'Authentication Required',
    description: 'This action requires GoDaddy OAuth permission for:',
    helperText: 'A popup window will open for secure authentication with GoDaddy',
    actionLabel: 'Authenticate with GoDaddy',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Authenticate with GoDaddy' });
    await userEvent.click(button);
  },
};

/** Simulates an error state with retry flow. */
export const InteractiveError: Story = {
  render: (args) => {
    const [status, setStatus] = useState<CtaButtonStatus>('error');
    const [errorMessage, setErrorMessage] = useState('Authentication failed. Please try again.');

    return (
      <CtaButton
        {...args}
        status={status}
        errorMessage={errorMessage}
        onAction={async () => {
          setStatus('processing');
          setErrorMessage('');
          await new Promise((resolve) => setTimeout(resolve, 1500));
          // Simulate random success/failure for demo
          const success = Math.random() > 0.5;
          if (success) {
            setStatus('success');
          } else {
            setStatus('error');
            setErrorMessage('Authentication failed again. Check your credentials.');
          }
        }}
      />
    );
  },
  args: {
    icon: <AsyncIcon icon="user-locked" />,
    title: 'Authentication Required',
    description: 'This action requires GoDaddy OAuth permission for:',
    actionLabel: 'Authenticate with GoDaddy',
  },
};

/**
 * All text strings can be overridden for i18n/localization.
 * Demonstrates custom messages for processing, success, and error states.
 */
export const CustomMessages: Story = {
  render: (args) => {
    const [status, setStatus] = useState<CtaButtonStatus>('pending');

    return (
      <CtaButton
        {...args}
        status={status}
        onAction={async () => {
          setStatus('processing');
          await new Promise((resolve) => setTimeout(resolve, 1500));
          setStatus('success');
        }}
      />
    );
  },
  args: {
    icon: <AsyncIcon icon="user-locked" />,
    title: 'Autenticación requerida',
    description: 'Esta acción requiere permiso OAuth de GoDaddy para:',
    helperText: 'Se abrirá una ventana emergente para la autenticación segura con GoDaddy',
    actionLabel: 'Autenticar con GoDaddy',
    closeLabel: 'Cerrar',
    processingMessage: 'Procesando...',
    successMessage: '¡Autenticación exitosa!',
    errorLabel: 'Error de autenticación',
    errorMessage: 'La autenticación falló. Por favor, inténtelo de nuevo.',
    retryLabel: 'Reintentar',
    cancelLabel: 'Cancelar',
  },
};
