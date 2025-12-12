import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderWithProviders } from '@/tests/test-utils';
import ChatAuthRequestMessage, { AuthRequestPayload } from './ChatAuthRequestMessage';

const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
};

vi.mock('@/lib/socketRegistry', () => ({
  getSharedSocket: () => mockSocket,
}));

vi.mock('@/stores/useStreamingConversationStore', () => ({
  useCurrentAppId: () => 'app-123',
}));

vi.mock('@/hooks/useStreamingWebSocket', () => ({
  useStreamingWebSocket: () => ({
    sendMessage: vi.fn(),
  }),
}));

vi.mock('@/lib/oauth-popup', () => ({
  openOAuthPopupAndAwait: vi.fn(),
}));

vi.mock('@/lib/request-context', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ChatAuthRequestMessage', () => {
  const defaultPayload: AuthRequestPayload = {
    type: 'auth_request',
    provider: 'godaddy',
    scopes: ['read', 'write'],
    redirectUrl: 'https://example.com/oauth',
    state: 'test-state-123',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render without crashing', () => {
    renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    expect(screen.getByText('Authentication Required')).toBeInTheDocument();
  });

  it('should display custom title when provided', () => {
    const payload = { ...defaultPayload, title: 'Custom Auth Title' };
    renderWithProviders(<ChatAuthRequestMessage payload={payload} />);

    expect(screen.getByText('Custom Auth Title')).toBeInTheDocument();
  });

  it('should display default title when not provided', () => {
    renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    expect(screen.getByText('Authentication Required')).toBeInTheDocument();
  });

  it('should display custom description when provided', () => {
    const payload = { ...defaultPayload, description: 'Custom description text' };
    renderWithProviders(<ChatAuthRequestMessage payload={payload} />);

    expect(screen.getByText('Custom description text')).toBeInTheDocument();
  });

  it('should display default description when not provided', () => {
    renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    expect(screen.getByText('This action requires your permission to access your account.')).toBeInTheDocument();
  });

  it('should render authenticate button in pending state', () => {
    renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    expect(screen.getByText('Authenticate with GoDaddy')).toBeInTheDocument();
  });

  it('should display provider name in button', () => {
    renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    expect(screen.getByText('Authenticate with GoDaddy')).toBeInTheDocument();
  });

  it('should show info text about popup window', () => {
    renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    expect(screen.getByText(/A popup window will open for secure authentication/i)).toBeInTheDocument();
  });

  it('should call openOAuthPopupAndAwait when authenticate button clicked', async () => {
    const { openOAuthPopupAndAwait } = await import('@/lib/oauth-popup');
    const { user } = renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    const button = screen.getByText('Authenticate with GoDaddy');
    await user.click(button);

    await waitFor(() => {
      expect(openOAuthPopupAndAwait).toHaveBeenCalledWith(
        defaultPayload.redirectUrl
      );
    });
  });

  it('should show authenticating status after button click', async () => {
    const { user } = renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    const button = screen.getByText('Authenticate with GoDaddy');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/Please continue authenticating in the popup window/i)).toBeInTheDocument();
    });
  });

  it('should register socket listener for oauth:result', () => {
    renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    expect(mockSocket.on).toHaveBeenCalledWith('oauth:result', expect.any(Function));
  });

  it('should unregister socket listener on unmount', () => {
    const { unmount } = renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    unmount();

    expect(mockSocket.off).toHaveBeenCalledWith('oauth:result', expect.any(Function));
  });

  it('should render lock icon', () => {
    renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    expect(screen.getByText('🔐')).toBeInTheDocument();
  });

  it('should have correct styling classes', () => {
    const { container } = renderWithProviders(<ChatAuthRequestMessage payload={defaultPayload} />);

    const mainDiv = container.querySelector('.border-intents-ux-warning-borderColor');
    expect(mainDiv).toBeInTheDocument();
  });

  it('should render with conversationId prop', () => {
    renderWithProviders(
      <ChatAuthRequestMessage payload={defaultPayload} conversationId="conv-123" />
    );

    expect(screen.getByText('Authentication Required')).toBeInTheDocument();
  });

  it('should handle different provider names', () => {
    const payload = { ...defaultPayload, provider: 'github' as 'godaddy' };
    renderWithProviders(<ChatAuthRequestMessage payload={payload} />);

    expect(screen.getByText(/Authenticate with github/i)).toBeInTheDocument();
  });
});
