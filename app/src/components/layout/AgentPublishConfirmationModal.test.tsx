/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import AgentPublishConfirmationModal from '@/components/layout/AgentPublishConfirmationModal';
import { renderWithProviders } from '@/tests/test-utils';

type ConfirmStatus = 'idle' | 'pending' | 'approved' | 'cancelled';

const mockDevelopStore = {
  publishStates: {} as Record<string, { agentPublishConfirmation?: ConfirmStatus }>,
  getPublishState(appId: string) {
    const slice = mockDevelopStore.publishStates[appId];
    return {
      agentPublishConfirmation: slice?.agentPublishConfirmation ?? 'idle',
    };
  },
  resolveAgentPublishConfirmation: vi.fn(),
};

vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: (state: typeof mockDevelopStore) => unknown) => selector(mockDevelopStore),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      builder_agent_publish_confirm_title: 'Publish to your live site?',
      builder_agent_publish_confirm_message:
        'The assistant is ready to publish your latest changes to your live site, making them public.',
      builder_agent_publish_confirm_publish: 'Publish now',
      builder_agent_publish_confirm_cancel: 'Not now',
    };
    return translations[key] || key;
  },
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (event: string) { return `${event}.click`; }),
  logImpressionEvent: vi.fn(function () { return vi.fn(); }),
}));

vi.mock('@ux/icon/cloud-upload', () => ({
  default: () => <span data-testid="agent-publish-cloud-icon" />,
}));

vi.mock('@ux/modal', () => ({
  default: ({
    title,
    children,
    onClose,
    'data-testid': dataTestId,
  }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    'data-testid'?: string;
  }) => (
    <div role="dialog" aria-label={title} data-testid={dataTestId}>
      <h2>{title}</h2>
      <button type="button" onClick={onClose} aria-label="Close">Close</button>
      <div>{children}</div>
    </div>
  ),
}));

vi.mock('@ux/box', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@ux/text', () => ({
  default: {
    p: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  },
}));

vi.mock('@ux/button', () => ({
  default: ({
    text,
    onClick,
    'data-testid': dataTestId,
  }: {
    text: string;
    onClick: () => void;
    'data-testid'?: string;
  }) => (
    <button type="button" onClick={onClick} data-testid={dataTestId}>{text}</button>
  ),
}));

describe('AgentPublishConfirmationModal', function agentPublishConfirmationModalTests() {
  const appId = 'app-test-1';

  beforeEach(function setup() {
    vi.clearAllMocks();
    mockDevelopStore.publishStates = {};
  });

  it('should render nothing when confirmation is not pending', function hidden() {
    mockDevelopStore.publishStates[appId] = { agentPublishConfirmation: 'idle' };

    renderWithProviders(<AgentPublishConfirmationModal appId={appId} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should render the confirmation dialog when pending', function shown() {
    mockDevelopStore.publishStates[appId] = { agentPublishConfirmation: 'pending' };

    renderWithProviders(<AgentPublishConfirmationModal appId={appId} />);

    expect(screen.getByRole('dialog', { name: 'Publish to your live site?' })).toBeInTheDocument();
    expect(screen.getByText(/ready to publish your latest changes/i)).toBeInTheDocument();
  });

  it('should render the cancel button before the publish button', function order() {
    mockDevelopStore.publishStates[appId] = { agentPublishConfirmation: 'pending' };

    renderWithProviders(<AgentPublishConfirmationModal appId={appId} />);

    const buttons = screen.getAllByRole('button');
    const cancelIndex = buttons.findIndex((b) => b.textContent === 'Not now');
    const publishIndex = buttons.findIndex((b) => b.textContent === 'Publish now');

    expect(cancelIndex).toBeGreaterThanOrEqual(0);
    expect(publishIndex).toBeGreaterThan(cancelIndex);
    expect(screen.getByTestId('agent-publish-confirm-button')).toHaveTextContent('Publish now');
  });

  it('should approve when the publish button is clicked', function approve() {
    mockDevelopStore.publishStates[appId] = { agentPublishConfirmation: 'pending' };

    renderWithProviders(<AgentPublishConfirmationModal appId={appId} />);
    fireEvent.click(screen.getByText('Publish now'));

    expect(mockDevelopStore.resolveAgentPublishConfirmation).toHaveBeenCalledWith(appId, true);
  });

  it('should decline when the cancel button is clicked', function declineCancel() {
    mockDevelopStore.publishStates[appId] = { agentPublishConfirmation: 'pending' };

    renderWithProviders(<AgentPublishConfirmationModal appId={appId} />);
    fireEvent.click(screen.getByText('Not now'));

    expect(mockDevelopStore.resolveAgentPublishConfirmation).toHaveBeenCalledWith(appId, false);
  });

  it('should decline when the modal is dismissed', function declineClose() {
    mockDevelopStore.publishStates[appId] = { agentPublishConfirmation: 'pending' };

    renderWithProviders(<AgentPublishConfirmationModal appId={appId} />);
    fireEvent.click(screen.getByLabelText('Close'));

    expect(mockDevelopStore.resolveAgentPublishConfirmation).toHaveBeenCalledWith(appId, false);
  });
});
