/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import { MediaType } from '@/app/[market]/develop/components/chat/AssetTypes';
import { renderWithProviders } from '@/tests/test-utils';
import { logActionEvent, logClickEvent } from '@/utils/instrumentation';
import ChatInput from './ChatInput';

const mockDevelopStore = {
  isMobile: false,
  isAssetManagerOpen: false,
  setIsAssetManagerOpen: vi.fn(),
  openUpgradeModal: vi.fn(),
  openCreditsModal: vi.fn(),
};

const mockUseSwitchboard = vi.hoisted(() => vi.fn(function (feature: string) {
  if (feature === 'appbuilder-image-manager') return true;
  if (feature === 'appbuilder-chat-gauge') return true;
  if (feature === 'airo-builder-chat-collapse-multiline-input') return true;
  return false;
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn(function (id: string) { return id; }),
  logActionEvent: vi.fn(function () { return vi.fn(); }),
  logClickEvent: vi.fn(function () { return vi.fn(); }),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: mockUseSwitchboard,
}));
vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({ data: { id: 'sub-1', plan: 'starter' }, isLoading: false }),
}));
vi.mock('@/hooks/useCreditGrants', () => ({
  useCreditGrants: () => ({ data: [{ creditsSpent: 50, creditsMax: 100 }], isLoading: false }),
}));
vi.mock('@/hooks/useSubscriptionWithPolling', () => ({
  useSubscriptionWithPolling: () => ({
    subscription: { id: 'sub-1', plan: 'starter', builderEntitlementId: 'ent-1' },
    isPurchaseDisabled: false,
    entitlementPollingTimedOut: false,
  }),
}));
vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/lib/logging', () => ({
  shipAnalyticsLog: vi.fn(),
}));

const mockStopSpeech = vi.fn();
const mockResetTranscript = vi.fn();
const mockToggleSpeech = vi.fn();
const mockSpeechRecognition = vi.hoisted(() => ({
  isListening: false,
  isSupported: true,
}));

vi.mock('@/hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    isListening: mockSpeechRecognition.isListening,
    isSupported: mockSpeechRecognition.isSupported,
    toggle: mockToggleSpeech,
    transcript: '',
    stop: mockStopSpeech,
    resetTranscript: mockResetTranscript,
  }),
}));

// Mock InputActionsPanel to spy on shouldCollapse prop
const mockInputActionsPanel = vi.hoisted(() => vi.fn(function (props: any) { return null; }));
vi.mock('@/app/[market]/develop/components/chat/InputActionsPanel', () => ({
  default: mockInputActionsPanel,
}));

// Spy on the multi-page rebuild queue driver. It must mount from ChatInput (which
// always renders), NOT from the chat-plans-gated InputActionsPanel — otherwise the
// queue strands when chat-plans is off (the selector card enqueues regardless).
const mockRebuildBuildQueueDriver = vi.hoisted(() => vi.fn());
vi.mock('@/app/[market]/develop/hooks/useRebuildBuildQueueDriver', () => ({
  useRebuildBuildQueueDriver: mockRebuildBuildQueueDriver,
}));

// Progress/Stop must mount flag-independently too: the driver runs for every cohort,
// so a chat-plans-off user can start a batch and must be able to see/stop it.
const mockRebuildQueueProgress = vi.hoisted(() => vi.fn(() => null));
vi.mock('@/app/[market]/develop/components/chat/RebuildQueueProgress', () => ({
  default: mockRebuildQueueProgress,
}));

describe('ChatInput', () => {
  const defaultProps = {
    inputValue: '',
    isDisabled: false,
    onInputChange: vi.fn(),
    onSendMessage: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDevelopStore.isMobile = false;
    mockDevelopStore.isAssetManagerOpen = false;
    mockSpeechRecognition.isListening = false;
    mockUseSwitchboard.mockImplementation(function (feature: string) {
      if (feature === 'appbuilder-image-manager') return true;
      if (feature === 'appbuilder-chat-gauge') return true;
      if (feature === 'airo-builder-chat-collapse-multiline-input') return true;
      return false;
    });
  });

  it('should render without crashing', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  describe('mediaLimitError', function mediaLimitErrorTests() {
    it('should show inline alert without dismiss control', function showAlert() {
      renderWithProviders(
        <ChatInput {...defaultProps} mediaLimitError="builder_chatfiles_error_max_attachments" />
      );

      const alert = screen.getByTestId('chat-attachment-limit-error');
      expect(alert).toHaveAttribute('role', 'alert');
      expect(alert).toHaveTextContent('builder_chatfiles_error_max_attachments');
      expect(screen.queryByRole('button', { name: 'builder_common_dismiss' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'builder_common_close' })).not.toBeInTheDocument();
    });

    it('should not render alert when mediaLimitError is null', function hideAlert() {
      renderWithProviders(<ChatInput {...defaultProps} mediaLimitError={null} />);

      expect(screen.queryByTestId('chat-attachment-limit-error')).not.toBeInTheDocument();
    });
  });

  it('mounts the rebuild queue driver even when airo-builder-chat-plans is off', () => {
    // Regression: the driver used to mount inside InputActionsPanel, which only
    // renders when chat-plans is on. The selector card enqueues regardless of the
    // flag, so with chat-plans off a batch would enqueue into a void and hang.
    // beforeEach leaves airo-builder-chat-plans → false, and InputActionsPanel is
    // mocked to null, so a driver call here proves ChatInput mounts it directly.
    renderWithProviders(<ChatInput {...defaultProps} />);

    expect(mockRebuildBuildQueueDriver).toHaveBeenCalled();
  });

  it('mounts RebuildQueueProgress even when airo-builder-chat-plans is off', () => {
    // The progress/Stop affordance must reach the chat-plans-off cohort too — the
    // driver runs for everyone, so those users can start a batch and need to stop it.
    // beforeEach leaves chat-plans → false and InputActionsPanel is mocked to null.
    renderWithProviders(<ChatInput {...defaultProps} />);

    expect(mockRebuildQueueProgress).toHaveBeenCalled();
  });

  it('hides PromptBox when InputActionsPanel reports hideComposerPrompt', async () => {
    mockUseSwitchboard.mockImplementation(function (feature: string) {
      if (feature === 'appbuilder-image-manager') return true;
      if (feature === 'appbuilder-chat-gauge') return true;
      if (feature === 'airo-builder-chat-collapse-multiline-input') return true;
      if (feature === 'airo-builder-chat-plans') return true;
      return false;
    });
    mockInputActionsPanel.mockImplementation(function (props: { onHideComposerPromptChange?: (hidden: boolean) => void }) {
      useEffect(() => {
        props.onHideComposerPromptChange?.(true);
      }, [props.onHideComposerPromptChange]);
      return null;
    });

    renderWithProviders(<ChatInput {...defaultProps} />);

    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  });

  it('should display textarea with placeholder', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('aria-placeholder', 'builder_chatinput_ask_airo');
  });

  it('should display processing placeholder when disabled', () => {
    renderWithProviders(<ChatInput {...defaultProps} isDisabled={true} />);

    expect(screen.getByRole('textbox')).toHaveAttribute(
      'aria-placeholder',
      'builder_chatinput_processing',
    );
  });

  it('should display input value', async () => {
    renderWithProviders(<ChatInput {...defaultProps} inputValue="Test message" />);

    // PromptBox 5.0's ExternalSyncPlugin hydrates the contenteditable with the
    // controlled `value` on a Lexical update tick (microtask), so the text
    // isn't visible synchronously after mount.
    const textarea = screen.getByRole('textbox');
    await waitFor(() => expect(textarea).toHaveTextContent('Test message'));
  });

  it('should call onInputChange when typing', async () => {
    const onInputChange = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput {...defaultProps} onInputChange={onInputChange} />
    );

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello');

    expect(onInputChange).toHaveBeenCalled();
  });

  it('should render send button', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'builder_chatinput_send' })).toBeInTheDocument();
  });

  it('should disable send button when no input value', () => {
    renderWithProviders(<ChatInput {...defaultProps} inputValue="" />);

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    expect(sendButton).toBeDisabled();
  });

  it('should disable send button when input is only whitespace', () => {
    renderWithProviders(<ChatInput {...defaultProps} inputValue="   " />);

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    expect(sendButton).toBeDisabled();
  });

  it('should not call onSendMessage via Enter key when input is empty', async () => {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput {...defaultProps} inputValue="" onSendMessage={onSendMessage} />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Enter}');

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('should not call onSendMessage via Enter key when input is only whitespace', async () => {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput {...defaultProps} inputValue="   " onSendMessage={onSendMessage} />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Enter}');

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('should enable send button when input has value', () => {
    renderWithProviders(<ChatInput {...defaultProps} inputValue="Test" />);

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    expect(sendButton).not.toBeDisabled();
  });

  it('should enable send when staged files exist without message text', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue=""
        stagedFiles={[
          {
            id: 's1',
            file: new File(['x'], 'a.png', { type: 'image/png' }),
            previewUrl: 'blob:mock',
          },
        ]}
        onRemoveStagedFile={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat-send-button')).not.toBeDisabled();
  });

  it('should call onSendMessage when send clicked with staged files only', async function sendStagedOnly() {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue=""
        onSendMessage={onSendMessage}
        stagedFiles={[
          {
            id: 's1',
            file: new File(['x'], 'a.png', { type: 'image/png' }),
            previewUrl: 'blob:mock',
          },
        ]}
        onRemoveStagedFile={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('chat-send-button'));

    expect(onSendMessage).toHaveBeenCalledOnce();
  });

  it('should enable send when only selectedAssets present without text', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue=""
        selectedAssets={[
          {
            imageUrl: 'https://example.com/x.jpg',
            filename: 'x.jpg',
            mediaType: MediaType.IMAGE,
            sourceType: 'gc',
            contentType: 'image/jpeg',
            size: 100,
            dimensions: { width: 10, height: 10 },
            thumbnailUrl: 'https://example.com/x.jpg',
          },
        ]}
        maxAssets={4}
        onClearSelectedAsset={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat-send-button')).not.toBeDisabled();
  });

  it('should enable send when referenced files exist without message text', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue=""
        referencedFiles={[{ path: 'src/pasted.txt', content: 'pasted body' }]}
      />
    );

    expect(screen.getByTestId('chat-send-button')).not.toBeDisabled();
  });

  it('should call onSendMessage when send clicked with referenced files only', async function sendRefsOnly() {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue=""
        onSendMessage={onSendMessage}
        referencedFiles={[{ path: 'src/pasted.txt', content: 'pasted body' }]}
      />
    );

    await user.click(screen.getByTestId('chat-send-button'));

    expect(onSendMessage).toHaveBeenCalledOnce();
  });

  it('should render stop button instead of send button when streaming', () => {
    renderWithProviders(
      <ChatInput {...defaultProps} inputValue="Test" isStreaming={true} onStopGeneration={vi.fn()} />
    );

    expect(screen.getByTestId('chat-stop-button')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-send-button')).not.toBeInTheDocument();
  });

  it('should call onStopGeneration when stop button clicked', async () => {
    const onStopGeneration = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput {...defaultProps} inputValue="Test" isStreaming={true} onStopGeneration={onStopGeneration} />
    );

    const stopButton = screen.getByTestId('chat-stop-button');
    await user.click(stopButton);

    await waitFor(() => {
      expect(onStopGeneration).toHaveBeenCalledOnce();
    });
  });

  it('should disable send button when isDisabled is true', () => {
    renderWithProviders(<ChatInput {...defaultProps} inputValue="Test" isDisabled={true} />);

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    expect(sendButton).toBeDisabled();
  });

  it('should disable send button while files are uploading', () => {
    renderWithProviders(
      <ChatInput {...defaultProps} inputValue="Test" uploadingStagedFileIds={['staged-1']} />
    );

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    expect(sendButton).toBeDisabled();
  });

  it('should not call onSendMessage via Enter key while files are uploading', async () => {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        onSendMessage={onSendMessage}
        uploadingStagedFileIds={['staged-1']}
      />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Enter}');

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('should not call onSendMessage via Enter key while streaming', async () => {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        onSendMessage={onSendMessage}
        isStreaming={true}
        onStopGeneration={vi.fn()}
      />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Enter}');

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('should allow Enter key submission when streaming without stop handler', async () => {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        onSendMessage={onSendMessage}
        isStreaming={true}
        // onStopGeneration intentionally omitted - edge case
      />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledOnce();
    });
  });

  it('should render send button when streaming without stop handler', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        isStreaming={true}
        // onStopGeneration intentionally omitted - edge case
      />
    );

    expect(screen.getByTestId('chat-send-button')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop-button')).not.toBeInTheDocument();
  });

  it('should render disabled stop button when isAwaitingStream is true and not yet streaming', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        isStreaming={false}
        isAwaitingStream={true}
        onStopGeneration={vi.fn()}
      />
    );

    const stopButton = screen.getByTestId('chat-stop-button');
    expect(stopButton).toBeInTheDocument();
    expect(stopButton).toHaveAttribute('aria-disabled', 'true');
    expect(stopButton).toHaveAttribute('tabindex', '-1');
    expect(stopButton).not.toBeDisabled();
    expect(screen.queryByTestId('chat-send-button')).not.toBeInTheDocument();
  });

  it('should log stop disabled enter action when awaiting stream starts', () => {
    const { rerender } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        appId="app-xyz"
        isStreaming={false}
        isAwaitingStream={false}
        onStopGeneration={vi.fn()}
      />
    );

    rerender(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        appId="app-xyz"
        isStreaming={false}
        isAwaitingStream={true}
        onStopGeneration={vi.fn()}
      />
    );

    expect(vi.mocked(logActionEvent)).toHaveBeenCalledWith({
      eid: 'develop.prompt.stop',
      action: 'load',
      customProperties: expect.objectContaining({
        appId: 'app-xyz',
        disabledAt: expect.any(Number),
      }),
    });
  });

  it('should not re-fire stop disabled load action when still awaiting stream on rerender', () => {
    const { rerender } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        appId="app-xyz"
        isStreaming={false}
        isAwaitingStream={true}
        onStopGeneration={vi.fn()}
      />
    );

    vi.mocked(logActionEvent).mockClear();

    rerender(
      <ChatInput
        {...defaultProps}
        inputValue="Updated prompt"
        appId="app-xyz"
        isStreaming={false}
        isAwaitingStream={true}
        onStopGeneration={vi.fn()}
      />
    );

    expect(vi.mocked(logActionEvent)).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'load' }),
    );
  });

  it('should log stop enabled action with disabled duration when streaming starts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const { rerender } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        appId="app-xyz"
        isStreaming={false}
        isAwaitingStream={true}
        onStopGeneration={vi.fn()}
      />
    );

    vi.setSystemTime(new Date('2024-01-01T00:00:05.000Z'));
    rerender(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        appId="app-xyz"
        isStreaming={true}
        isAwaitingStream={true}
        onStopGeneration={vi.fn()}
      />
    );

    expect(vi.mocked(logActionEvent)).toHaveBeenCalledWith({
      eid: 'develop.prompt.stop',
      action: 'focus',
      customProperties: expect.objectContaining({
        appId: 'app-xyz',
        enabledAt: Date.parse('2024-01-01T00:00:05.000Z'),
        disabledDurationMs: 5000,
      }),
    });

    vi.useRealTimers();
  });

  it('should not call onStopGeneration when the disabled stop button is clicked while not streaming', () => {
    const onStopGeneration = vi.fn();
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        isStreaming={false}
        isAwaitingStream={true}
        onStopGeneration={onStopGeneration}
      />
    );

    fireEvent.click(screen.getByTestId('chat-stop-button'));

    expect(onStopGeneration).not.toHaveBeenCalled();
    expect(vi.mocked(logClickEvent)).not.toHaveBeenCalledWith('develop.prompt.stop', expect.anything());
    expect(vi.mocked(logActionEvent)).toHaveBeenCalledWith({
      eid: 'develop.prompt.stop',
      action: 'disabled',
      customProperties: undefined,
    });
  });

  it('should log disabled stop action on click while awaiting stream', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        appId="app-xyz"
        isStreaming={false}
        isAwaitingStream={true}
        onStopGeneration={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('chat-stop-button'));

    expect(vi.mocked(logActionEvent)).toHaveBeenCalledWith({
      eid: 'develop.prompt.stop',
      action: 'disabled',
      customProperties: { appId: 'app-xyz' },
    });
  });

  it('should log disabled stop action on click while awaiting stream even when isDisabled is true', async () => {
    const onStopGeneration = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        appId="app-xyz"
        isDisabled={true}
        isStreaming={false}
        isAwaitingStream={true}
        onStopGeneration={onStopGeneration}
      />
    );

    const stopButton = screen.getByTestId('chat-stop-button');
    expect(stopButton).not.toBeDisabled();

    await user.click(stopButton);

    expect(onStopGeneration).not.toHaveBeenCalled();
    expect(vi.mocked(logActionEvent)).toHaveBeenCalledWith({
      eid: 'develop.prompt.stop',
      action: 'disabled',
      customProperties: { appId: 'app-xyz' },
    });
  });

  it('should not log disabled stop action on click when stop is enabled', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        isStreaming={true}
        isAwaitingStream={true}
        onStopGeneration={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('chat-stop-button'));

    expect(vi.mocked(logActionEvent)).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'disabled' }),
    );
  });

  it('should not log disabled stop action on click when not awaiting stream', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        isStreaming={false}
        isAwaitingStream={false}
        onStopGeneration={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('chat-send-button'));

    expect(vi.mocked(logActionEvent)).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'disabled' }),
    );
  });

  it('should render enabled stop button when both isAwaitingStream and isStreaming are true', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        isStreaming={true}
        isAwaitingStream={true}
        onStopGeneration={vi.fn()}
      />
    );

    const stopButton = screen.getByTestId('chat-stop-button');
    expect(stopButton).toBeInTheDocument();
    expect(stopButton).not.toBeDisabled();
    expect(screen.queryByTestId('chat-send-button')).not.toBeInTheDocument();
  });

  it('should render send button when isAwaitingStream is true but no stop handler is provided', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        isAwaitingStream={true}
        // onStopGeneration intentionally omitted
      />
    );

    expect(screen.getByTestId('chat-send-button')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-stop-button')).not.toBeInTheDocument();
  });

  it('should not call onSendMessage via Enter key while awaiting stream', async () => {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        onSendMessage={onSendMessage}
        isAwaitingStream={true}
        onStopGeneration={vi.fn()}
      />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Enter}');

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('should disable textarea when isDisabled is true', () => {
    renderWithProviders(<ChatInput {...defaultProps} isDisabled={true} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('aria-disabled', 'true');
  });

  it('should call onSendMessage when send button clicked', async () => {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput {...defaultProps} inputValue="Test" onSendMessage={onSendMessage} appId="app-xyz" />
    );

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    await user.click(sendButton);

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('develop.prompt.send', { appId: 'app-xyz' });
  });

  it('should call onSendMessage when Enter key pressed', async () => {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput {...defaultProps} inputValue="Test" onSendMessage={onSendMessage} />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('develop.prompt.send', undefined);
  });

  it('should not call onSendMessage when Shift+Enter pressed', async () => {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput {...defaultProps} inputValue="Test" onSendMessage={onSendMessage} />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  // Modifier+Enter (Alt/Meta/Ctrl) suppresses submit and inserts a newline at
  // the caret. The exact splice point depends on the browser's selection state;
  // in jsdom the contenteditable's selection isn't positioned the way it is in
  // a real browser, so we only assert that *some* newline was emitted to
  // onInputChange — the splice point is verified manually + by E2E. Tracked
  // upstream in DF-4879.
  it('should not call onSendMessage when Alt+Enter pressed', async () => {
    const onSendMessage = vi.fn();
    const onInputChange = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        onInputChange={onInputChange}
        onSendMessage={onSendMessage}
      />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Alt>}{Enter}{/Alt}');

    expect(onSendMessage).not.toHaveBeenCalled();
    expect(onInputChange).toHaveBeenCalledWith(expect.stringMatching(/\n/));
  });

  it('should not call onSendMessage when Cmd+Enter pressed', async () => {
    const onSendMessage = vi.fn();
    const onInputChange = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        onInputChange={onInputChange}
        onSendMessage={onSendMessage}
      />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(onSendMessage).not.toHaveBeenCalled();
    expect(onInputChange).toHaveBeenCalledWith(expect.stringMatching(/\n/));
  });

  it('should have correct textarea attributes', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('id', 'chat-input-textarea');
  });

  it('should have correct send button attributes and log send on click', async () => {
    const { user } = renderWithProviders(<ChatInput {...defaultProps} inputValue="Test" />);

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    expect(sendButton).toHaveAttribute('id', 'chat-send-button');
    expect(sendButton).not.toHaveAttribute('data-eid');
    await user.click(sendButton);
    expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith('develop.prompt.send', undefined);
  });

  it('should render attachment menu when appId and onStageFiles provided', () => {
    renderWithProviders(
      <ChatInput {...defaultProps} appId="test-app-123" onStageFiles={vi.fn()} />
    );

    expect(screen.getByTestId('chat-attachment-menu-trigger')).toBeInTheDocument();
  });

  it('should not render attachment menu when appId is not provided', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    expect(screen.queryByTestId('chat-attachment-menu-trigger')).not.toBeInTheDocument();
  });

  it('should not render attachment menu when onStageFiles is not provided', () => {
    renderWithProviders(<ChatInput {...defaultProps} appId="test-app-123" />);

    expect(screen.queryByTestId('chat-attachment-menu-trigger')).not.toBeInTheDocument();
  });

  it('should disable attachment menu button when disabled', () => {
    renderWithProviders(
      <ChatInput {...defaultProps} appId="test-app-123" onStageFiles={vi.fn()} isDisabled={true} />
    );

    expect(screen.getByTestId('chat-attachment-menu-trigger')).toBeDisabled();
  });

  it('should disable attachment menu when selectedAssets length equals maxAssets', function disableAtLimit() {
    const maxAssets = 4;
    const assetsAtLimit = Array(maxAssets).fill({
      imageUrl: 'https://example.com/image.jpg',
      filename: 'test.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc',
      contentType: 'image/jpeg',
      size: 12345,
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    });

    renderWithProviders(
      <ChatInput
        {...defaultProps}
        appId="test-app-123"
        onStageFiles={vi.fn()}
        selectedAssets={assetsAtLimit}
        maxAssets={maxAssets}
        onClearSelectedAsset={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat-attachment-menu-trigger')).toBeDisabled();
  });

  it('should enable attachment menu when selectedAssets length is less than maxAssets', function enableBelowLimit() {
    const maxAssets = 4;
    const assetsBelowLimit = Array(maxAssets - 1).fill({
      imageUrl: 'https://example.com/image.jpg',
      filename: 'test.jpg',
      mediaType: MediaType.IMAGE,
      sourceType: 'gc',
      contentType: 'image/jpeg',
      size: 12345,
      dimensions: { width: 800, height: 600 },
      thumbnailUrl: 'https://example.com/thumb.jpg',
    });

    renderWithProviders(
      <ChatInput
        {...defaultProps}
        appId="test-app-123"
        onStageFiles={vi.fn()}
        selectedAssets={assetsBelowLimit}
        maxAssets={maxAssets}
        onClearSelectedAsset={vi.fn()}
      />
    );

    expect(screen.getByTestId('chat-attachment-menu-trigger')).not.toBeDisabled();
  });

  describe('chat gauge Switchboard', () => {
    it('should render UsageGauge when the switchboard flag is on', function gaugeVisibleWhenFlagOn() {
      mockUseSwitchboard.mockImplementation(function (feature: string) {
        if (feature === 'appbuilder-image-manager') return true;
        if (feature === 'appbuilder-chat-gauge') return true;
        return false;
      });

      renderWithProviders(<ChatInput {...defaultProps} appId="test-app-123" />);

      expect(screen.getByRole('button', { name: /builder_usage_gauge_aria_label/i })).toBeInTheDocument();
    });

    it('should not render UsageGauge when the switchboard flag is off', function gaugeHiddenWhenFlagOff() {
      mockUseSwitchboard.mockImplementation(function (feature: string) {
        if (feature === 'appbuilder-image-manager') return true;
        if (feature === 'appbuilder-chat-gauge') return false;
        return false;
      });

      renderWithProviders(<ChatInput {...defaultProps} appId="test-app-123" />);

      expect(screen.queryByRole('button', { name: /builder_usage_gauge_aria_label/i })).not.toBeInTheDocument();
    });
  });

  describe('budget exceeded', () => {
    it('should display budget exceeded placeholder when isBudgetExceeded is true', () => {
      renderWithProviders(<ChatInput {...defaultProps} isBudgetExceeded={true} />);

      expect(screen.getByRole('textbox')).toHaveAttribute(
        'aria-placeholder',
        'builder_chatinput_budget_exceeded',
      );
    });

    it('should disable textarea when isBudgetExceeded is true', () => {
      renderWithProviders(<ChatInput {...defaultProps} isBudgetExceeded={true} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveAttribute('aria-disabled', 'true');
    });

    it('should disable send button when isBudgetExceeded is true even with input value', () => {
      renderWithProviders(<ChatInput {...defaultProps} inputValue="Test" isBudgetExceeded={true} />);

      const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
      expect(sendButton).toBeDisabled();
    });

    it('should disable attachment menu when isBudgetExceeded is true', () => {
      renderWithProviders(
        <ChatInput {...defaultProps} appId="test-app-123" onStageFiles={vi.fn()} isBudgetExceeded={true} />
      );

      expect(screen.getByTestId('chat-attachment-menu-trigger')).toBeDisabled();
    });

    it('should disable speech button when isBudgetExceeded is true', () => {
      renderWithProviders(<ChatInput {...defaultProps} isBudgetExceeded={true} />);

      const speechButton = screen.getByRole('button', { name: 'builder_chatinput_start_listening' });
      expect(speechButton).toBeDisabled();
    });

    it('should prioritize budget exceeded placeholder over processing placeholder', () => {
      renderWithProviders(<ChatInput {...defaultProps} isDisabled={true} isBudgetExceeded={true} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toHaveAttribute('aria-placeholder', 'builder_chatinput_budget_exceeded');
      expect(textarea).not.toHaveAttribute('aria-placeholder', 'builder_chatinput_processing');
    });
  });

  describe('large paste detection', () => {
    it('should call onLargePasteDetected when pasting >4000 chars', async function detectLargePaste() {
      const onLargePasteDetected = vi.fn();
      renderWithProviders(
        <ChatInput {...defaultProps} onLargePasteDetected={onLargePasteDetected} />
      );

      const textarea = screen.getByRole('textbox');
      const largeText = 'x'.repeat(4001);
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as any;
      pasteEvent.clipboardData = { getData: () => largeText };
      textarea.dispatchEvent(pasteEvent);

      expect(onLargePasteDetected).toHaveBeenCalledWith(largeText);
    });

    it('should allow normal paste when content is at or under 4000 chars', function allowSmallPaste() {
      const onLargePasteDetected = vi.fn();
      renderWithProviders(
        <ChatInput {...defaultProps} onLargePasteDetected={onLargePasteDetected} />
      );

      const textarea = screen.getByRole('textbox');
      const smallText = 'x'.repeat(4000);
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as any;
      pasteEvent.clipboardData = { getData: () => smallText };
      textarea.dispatchEvent(pasteEvent);

      expect(onLargePasteDetected).not.toHaveBeenCalled();
    });

    it('should allow normal paste when onLargePasteDetected is not provided', function noHandler() {
      renderWithProviders(<ChatInput {...defaultProps} />);

      const textarea = screen.getByRole('textbox');
      const largeText = 'x'.repeat(10000);
      const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as any;
      pasteEvent.clipboardData = { getData: () => largeText };
      const prevented = !textarea.dispatchEvent(pasteEvent);

      expect(prevented).toBe(false);
    });
  });

  describe('paste handling', () => {
    it('should call onStageFiles and preventDefault when pasting a file', function pasteFile() {
      const onStageFiles = vi.fn();
      const pastedFile = new File(['pixel'], 'screenshot.png', { type: 'image/png' });
      renderWithProviders(
        <ChatInput {...defaultProps} appId="app-1" onStageFiles={onStageFiles} />
      );

      const textarea = screen.getByRole('textbox');
      const defaultNotPrevented = fireEvent.paste(textarea, {
        clipboardData: {
          items: [{
            type: 'image/png',
            kind: 'file',
            getAsFile: () => pastedFile,
          }],
        },
      });

      expect(defaultNotPrevented).toBe(false);
      expect(onStageFiles).toHaveBeenCalledWith([pastedFile]);
    });

    it('should not interfere when pasting plain text', function pasteText() {
      const onStageFiles = vi.fn();
      renderWithProviders(
        <ChatInput {...defaultProps} appId="app-1" onStageFiles={onStageFiles} />
      );

      const textarea = screen.getByRole('textbox');
      const defaultNotPrevented = fireEvent.paste(textarea, {
        clipboardData: {
          items: [{ type: 'text/plain', kind: 'string', getAsFile: () => null }],
        },
      });

      expect(defaultNotPrevented).toBe(true);
      expect(onStageFiles).not.toHaveBeenCalled();
    });

    it('should not handle paste when asset limit is reached', function pasteAtLimit() {
      const onStageFiles = vi.fn();
      renderWithProviders(
        <ChatInput
          {...defaultProps}
          appId="app-1"
          onStageFiles={onStageFiles}
          selectedAssets={[{
            imageUrl: 'https://example.com/existing.jpg',
            filename: 'existing.jpg',
            mediaType: MediaType.IMAGE,
            sourceType: 'gc',
            contentType: 'image/jpeg',
            size: 1000,
            dimensions: { width: 100, height: 100 },
            thumbnailUrl: 'https://example.com/thumb.jpg',
          }]}
          maxAssets={1}
          onClearSelectedAsset={vi.fn()}
        />
      );

      const textarea = screen.getByRole('textbox');
      fireEvent.paste(textarea, {
        clipboardData: {
          items: [{
            type: 'image/png',
            kind: 'file',
            getAsFile: () => new File(['pixel'], 'screenshot.png', { type: 'image/png' }),
          }],
        },
      });

      expect(onStageFiles).not.toHaveBeenCalled();
    });
  });

  describe('multi-element select chips', () => {
    const elementContext = (n: number, tagName: string) => ({
      number: n,
      elementInfo: { tagName },
    }) as any;

    // Mention chips render inside PromptBox 5.0's Lexical contenteditable as
    // `<span class="airo-primitives-mention-chip">` with two child spans: the
    // prefix (`#N`) and the TAG_LABELS-mapped label (e.g. `h1` → "Title",
    // `img` → "Image"). We query by the chip wrapper class so the assertion
    // doesn't depend on text-broken-across-spans matching.
    function getRenderedChips(): HTMLElement[] {
      return Array.from(
        document.querySelectorAll<HTMLElement>('.airo-primitives-mention-chip'),
      );
    }

    function chipText(chip: HTMLElement): string {
      const prefix = chip.querySelector('.airo-primitives-mention-chip__prefix')?.textContent ?? '';
      const label = chip.querySelector('.airo-primitives-mention-chip__label')?.textContent ?? '';
      return `${prefix} ${label}`;
    }

    it('should render a chip per aiEditContext using TAG_LABELS for the label', async function renderChips() {
      renderWithProviders(
        <ChatInput
          {...defaultProps}
          isMultiElementSelect={true}
          aiEditContexts={[elementContext(1, 'h1'), elementContext(2, 'img')]}
        />
      );

      await waitFor(() => expect(getRenderedChips()).toHaveLength(2));
      const texts = getRenderedChips().map(chipText);
      expect(texts).toEqual(['#1 Title', '#2 Image']);
    });

    it('should call onRemoveAiEditContext with the chip number when remove icon clicked', async function chipRemove() {
      const onRemoveAiEditContext = vi.fn();
      const { user } = renderWithProviders(
        <ChatInput
          {...defaultProps}
          isMultiElementSelect={true}
          aiEditContexts={[elementContext(1, 'h1'), elementContext(2, 'img')]}
          onRemoveAiEditContext={onRemoveAiEditContext}
        />
      );

      await waitFor(() => expect(getRenderedChips()).toHaveLength(2));
      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      await user.click(removeButtons[1]!);

      expect(onRemoveAiEditContext).toHaveBeenCalledWith(2);
    });

    it('should not render multi-element chips when flag is off', async function noChipsWhenOff() {
      renderWithProviders(
        <ChatInput
          {...defaultProps}
          isMultiElementSelect={false}
          aiEditContexts={[elementContext(1, 'h1')]}
        />
      );

      // Wait a microtask for Lexical's first commit; chips never appear when flag is off.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(getRenderedChips()).toHaveLength(0);
    });

    it('should skip contexts without a number', async function skipNullNumber() {
      renderWithProviders(
        <ChatInput
          {...defaultProps}
          isMultiElementSelect={true}
          aiEditContexts={[
            { number: null, elementInfo: { tagName: 'h1' } } as any,
            elementContext(2, 'img'),
          ]}
        />
      );

      await waitFor(() => expect(getRenderedChips()).toHaveLength(1));
      expect(chipText(getRenderedChips()[0]!)).toBe('#2 Image');
    });

    // Regression: PromptBox.handleStop fires `onChange("")` synchronously after
    // `onStop()`. Without the isStopFlowRef guard, that empty value reaches the
    // editor, ExternalSyncPlugin removes the mention nodes, and the chip-removal
    // discriminator calls onRemoveAiEditContext for every chip — wiping the
    // parent's aiEditContexts state every time the user hits stop.
    it('should not call onRemoveAiEditContext when stop is clicked mid-stream', async function stopPreservesChips() {
      const onStopGeneration = vi.fn();
      const onRemoveAiEditContext = vi.fn();
      const onInputChange = vi.fn();
      const { user } = renderWithProviders(
        <ChatInput
          {...defaultProps}
          inputValue="Test"
          isStreaming={true}
          isMultiElementSelect={true}
          aiEditContexts={[elementContext(1, 'h1'), elementContext(2, 'img')]}
          onStopGeneration={onStopGeneration}
          onRemoveAiEditContext={onRemoveAiEditContext}
          onInputChange={onInputChange}
        />
      );

      await waitFor(() => expect(getRenderedChips()).toHaveLength(2));

      const stopButton = screen.getByTestId('chat-stop-button');
      await user.click(stopButton);

      await waitFor(() => expect(onStopGeneration).toHaveBeenCalledOnce());

      // Critical: stop must not wipe aiEditContexts via the chip-removal discriminator.
      expect(onRemoveAiEditContext).not.toHaveBeenCalled();
      // The PromptBox's synchronous onChange("") must not propagate either.
      expect(onInputChange).not.toHaveBeenCalledWith('');
    });

    // The chip-removal discriminator at handleMentionRemoved checks
    // aiEditContextsRef.current to distinguish user-driven removals (chip ✕,
    // backspace) from programmatic ones (parent state already updated). When
    // the parent removes a context first and the resulting onMentionRemoved
    // cascade fires, the ref no longer contains the number, so
    // onRemoveAiEditContext must NOT be called (avoiding a double-fire).
    it('should not call onRemoveAiEditContext when chip removal is programmatic', async function discriminatesProgrammaticRemoval() {
      const onRemoveAiEditContext = vi.fn();
      const { rerender } = renderWithProviders(
        <ChatInput
          {...defaultProps}
          isMultiElementSelect={true}
          aiEditContexts={[elementContext(1, 'h1'), elementContext(2, 'img')]}
          onRemoveAiEditContext={onRemoveAiEditContext}
        />
      );

      await waitFor(() => expect(getRenderedChips()).toHaveLength(2));

      // Parent removes context #2 first; the syncMentionChips effect will
      // call removeElementMention(2), which fires onMentionRemoved(2) — but
      // by then aiEditContextsRef.current no longer contains #2, so the
      // discriminator must short-circuit.
      rerender(
        <ChatInput
          {...defaultProps}
          isMultiElementSelect={true}
          aiEditContexts={[elementContext(1, 'h1')]}
          onRemoveAiEditContext={onRemoveAiEditContext}
        />
      );

      await waitFor(() => expect(getRenderedChips()).toHaveLength(1));
      expect(onRemoveAiEditContext).not.toHaveBeenCalled();
    });

    // Flipping isMultiElementSelect from true → false while contexts remain
    // populated must tear down the existing chips. The desired set becomes []
    // regardless of aiEditContexts, so syncMentionChips removes every tracked
    // mention.
    it('should tear down chips when isMultiElementSelect flips from true to false', async function teardownChipsOnFlagOff() {
      const { rerender } = renderWithProviders(
        <ChatInput
          {...defaultProps}
          isMultiElementSelect={true}
          aiEditContexts={[elementContext(1, 'h1'), elementContext(2, 'img')]}
        />
      );

      await waitFor(() => expect(getRenderedChips()).toHaveLength(2));

      rerender(
        <ChatInput
          {...defaultProps}
          isMultiElementSelect={false}
          aiEditContexts={[elementContext(1, 'h1'), elementContext(2, 'img')]}
        />
      );

      await waitFor(() => expect(getRenderedChips()).toHaveLength(0));
    });

    // tagAndBindInnerEditor uses a MutationObserver to re-tag and re-bind on
    // every editor remount (PromptBox could in theory swap its inner Lexical
    // ContentEditable). Simulate a remount by removing the editor element and
    // re-inserting a fresh one with the marker class; the observer should
    // restore the id/data-testid on the new node.
    it('should re-tag the inner editor with id and data-testid after a remount', async function retagSurvivesRemount() {
      renderWithProviders(<ChatInput {...defaultProps} />);

      const card = await screen.findByTestId('chat-input-card');
      const original = card.querySelector<HTMLElement>('.airo-input-prompt-box__entry');
      expect(original).not.toBeNull();
      expect(original!.id).toBe('chat-input-textarea');
      expect(original!.getAttribute('data-testid')).toBe('chat-input-textarea');

      // Force a remount: remove the marker class so the helper stops seeing
      // it, then re-add it on a fresh node. Wrap in act() so React flushes
      // any subsequent effects, and give the MutationObserver a tick to fire.
      await act(async () => {
        original!.classList.remove('airo-input-prompt-box__entry');
        original!.removeAttribute('id');
        original!.removeAttribute('data-testid');
        const replacement = document.createElement('div');
        replacement.className = 'airo-input-prompt-box__entry';
        original!.parentElement!.appendChild(replacement);
        // MutationObserver fires asynchronously; wait one task.
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      const replacement = card.querySelector<HTMLElement>('.airo-input-prompt-box__entry');
      expect(replacement).not.toBeNull();
      expect(replacement!.id).toBe('chat-input-textarea');
      expect(replacement!.getAttribute('data-testid')).toBe('chat-input-textarea');
    });
  });

  describe('speech recognition', () => {
    it('should render mic button without critical design when not listening', function micDefault() {
      renderWithProviders(<ChatInput {...defaultProps} />);

      const micButton = screen.getByRole('button', { name: 'builder_chatinput_start_listening' });
      expect(micButton).not.toHaveClass('ux-button-critical');
    });

    it('should render mic button with critical design when listening', function micCritical() {
      mockSpeechRecognition.isListening = true;
      renderWithProviders(<ChatInput {...defaultProps} />);

      const micButton = screen.getByRole('button', { name: 'builder_homepage_hero_stop_listening' });
      expect(micButton).toHaveClass('ux-button-critical');
    });

    it('should disable textarea when listening', function disableTextareaWhileListening() {
      mockSpeechRecognition.isListening = true;
      renderWithProviders(<ChatInput {...defaultProps} inputValue="Test" />);

      const textarea = screen.getByRole('textbox');
      // PromptBox 5.0's `isListening` flips the contenteditable to `contenteditable="false"`.
      expect(textarea).toHaveAttribute('contenteditable', 'false');
    });

    it('should stop speech and reset transcript when sending while listening via button click', async function stopOnButtonClick() {
      mockSpeechRecognition.isListening = true;
      const onSendMessage = vi.fn();
      const { user } = renderWithProviders(
        <ChatInput {...defaultProps} inputValue="Test" onSendMessage={onSendMessage} />
      );

      // Clear mocks after render (ensureMicrophoneOffOnMount calls stopSpeech on mount)
      vi.clearAllMocks();

      // Note: Enter key cannot be tested for speech cleanup because textarea is disabled
      // when listening. Users must click the send button to send while voice recording.
      const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
      await user.click(sendButton);

      await waitFor(() => {
        expect(mockStopSpeech).toHaveBeenCalledOnce();
        expect(mockResetTranscript).toHaveBeenCalledOnce();
        expect(onSendMessage).toHaveBeenCalledOnce();
      });
    });

    it('should not call stop or reset when sending while not listening', async function noCleanupWhenNotListening() {
      mockSpeechRecognition.isListening = false;
      const onSendMessage = vi.fn();
      const { user } = renderWithProviders(
        <ChatInput {...defaultProps} inputValue="Test" onSendMessage={onSendMessage} />
      );

      // Clear mocks after render (ensureMicrophoneOffOnMount calls stopSpeech on mount)
      vi.clearAllMocks();

      const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
      await user.click(sendButton);

      await waitFor(() => {
        expect(onSendMessage).toHaveBeenCalledOnce();
      });
      expect(mockStopSpeech).not.toHaveBeenCalled();
      expect(mockResetTranscript).not.toHaveBeenCalled();
    });
  });

  describe('InputActionsPanel collapse behavior', () => {
    let resizeObserverCallback: ResizeObserverCallback | null = null;

    // Helper to safely get shouldCollapse prop from last mock call
    const getLastShouldCollapse = () => {
      const calls = mockInputActionsPanel.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toBeDefined();
      expect(lastCall[0]).toBeDefined();
      return lastCall[0].shouldCollapse as boolean;
    };

    // Helper to trigger ResizeObserver callback and advance debounce timer
    const triggerResize = (element: HTMLTextAreaElement | HTMLElement) => {
      if (resizeObserverCallback) {
        act(() => {
          resizeObserverCallback(
            [{ target: element as Element, contentRect: {} as DOMRectReadOnly, borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }],
            {} as ResizeObserver
          );
          // Advance timer to trigger debounced checkLines (100ms debounce)
          vi.advanceTimersByTime(100);
        });
      }
    };

    // Helper to create mock AiEditContext
    const createMockContext = (number: number, tagName: string = 'div') => ({
      screenshot: null,
      elementInfo: { tagName, textContent: null, className: '', id: '', selector: '', rect: { top: 0, left: 0, width: 0, height: 0 }, computedStyles: {} },
      number,
      selector: `element-${number}`,
      devContext: null,
    });

    beforeEach(() => {
      resizeObserverCallback = null;
      mockInputActionsPanel.mockReturnValue(null);
      vi.useFakeTimers();

      // Mock document.getElementById to find element by data-testid if id lookup fails
      const originalGetElementById = document.getElementById.bind(document);
      document.getElementById = vi.fn(function (id: string) {
        const elem = originalGetElementById(id);
        if (elem) return elem;
        // Fallback: find by data-testid if id attribute not set yet
        if (id === 'chat-input-textarea') {
          return document.querySelector('[data-testid="chat-input-textarea"]') as HTMLElement;
        }
        return null;
      }) as any;

      // Mock getComputedStyle to return valid CSS values
      window.getComputedStyle = vi.fn(function () { return {
        lineHeight: '21px',
        paddingTop: '0px',
        paddingBottom: '0px',
        getPropertyValue: vi.fn(function (prop: string) {
          if (prop === 'line-height') return '21px';
          if (prop === 'padding-top') return '0px';
          if (prop === 'padding-bottom') return '0px';
          return '';
        }),
      }; }) as any;

      // Install controllable ResizeObserver mock
      vi.stubGlobal(
        'ResizeObserver',
        class ResizeObserverStub {
          constructor(callback: ResizeObserverCallback) {
            resizeObserverCallback = callback;
          }
          observe = vi.fn();
          unobserve = vi.fn();
          disconnect = vi.fn();
        }
      );

      // Enable chat plans and multiline collapse feature flags
      mockUseSwitchboard.mockImplementation(function (feature: string) {
        if (feature === 'airo-builder-chat-plans') return true;
        if (feature === 'airo-builder-chat-collapse-multiline-input') return true;
        if (feature === 'appbuilder-image-manager') return true;
        if (feature === 'appbuilder-chat-gauge') return true;
        return false;
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('should pass shouldCollapse=false to InputActionsPanel when lines <= 3', () => {
      renderWithProviders(
        <ChatInput {...defaultProps} inputValue="" />
      );

      const textarea = screen.getByTestId('chat-input-textarea') as HTMLTextAreaElement;

      // Mock scrollHeight for 2 lines (lineHeight ~21px, so 2 lines = ~42px)
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 42,
      });

      triggerResize(textarea);

      // Verify InputActionsPanel receives shouldCollapse=false
      expect(getLastShouldCollapse()).toBe(false);
    });

    it('should pass shouldCollapse=true when transitioning from <=3 to >3 lines', () => {
      renderWithProviders(
        <ChatInput {...defaultProps} inputValue="" />
      );

      const textarea = screen.getByTestId('chat-input-textarea') as HTMLTextAreaElement;

      // Start with 2 lines
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 42,
      });

      triggerResize(textarea);

      // Verify shouldCollapse is false initially
      expect(getLastShouldCollapse()).toBe(false);

      // Transition to 4 lines
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 85,
      });

      triggerResize(textarea);

      // Verify shouldCollapse is now true (rising edge detected)
      expect(getLastShouldCollapse()).toBe(true);
    });

    it('should reset collapse trigger when lines go back to <=3', () => {
      renderWithProviders(
        <ChatInput {...defaultProps} inputValue="" />
      );

      const textarea = screen.getByTestId('chat-input-textarea') as HTMLTextAreaElement;
      textarea.id = 'chat-input-textarea';

      // Start with 4 lines (collapsed)
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 85,
      });

      triggerResize(textarea);

      // Verify shouldCollapse is true
      expect(getLastShouldCollapse()).toBe(true);

      // Go back to 2 lines
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 42,
      });

      triggerResize(textarea);

      // Verify shouldCollapse is now false (reset)
      expect(getLastShouldCollapse()).toBe(false);
    });

    it('should trigger collapse again on subsequent transitions from <=3 to >3', () => {
      renderWithProviders(
        <ChatInput {...defaultProps} inputValue="" />
      );

      const textarea = screen.getByTestId('chat-input-textarea') as HTMLTextAreaElement;
      textarea.id = 'chat-input-textarea';

      // First transition: 2 → 4 lines
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 42,
      });
      triggerResize(textarea);
      expect(getLastShouldCollapse()).toBe(false);

      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 85,
      });
      triggerResize(textarea);
      expect(getLastShouldCollapse()).toBe(true);

      // Go back to 1 line (resets trigger)
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 21,
      });
      triggerResize(textarea);
      expect(getLastShouldCollapse()).toBe(false);

      // Second transition: 1 → 4 lines (should trigger collapse again)
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 85,
      });
      triggerResize(textarea);
      expect(getLastShouldCollapse()).toBe(true);
    });

    it('should not trigger collapse when staying above 3 lines', () => {
      renderWithProviders(
        <ChatInput {...defaultProps} inputValue="" />
      );

      const textarea = screen.getByTestId('chat-input-textarea') as HTMLTextAreaElement;
      textarea.id = 'chat-input-textarea';

      // Start with 4 lines
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 85,
      });
      triggerResize(textarea);

      expect(getLastShouldCollapse()).toBe(true);

      // Change to 5 lines (still > 3)
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 106,
      });
      triggerResize(textarea);

      // Should remain true, not re-trigger (no new render expected for shouldCollapse change)
      expect(getLastShouldCollapse()).toBe(true);
    });

    it('should not collapse when feature flag is off', () => {
      // Override beforeEach to disable the flag
      mockUseSwitchboard.mockImplementation(function (feature: string) {
        if (feature === 'airo-builder-chat-plans') return true;
        if (feature === 'airo-builder-chat-collapse-multiline-input') return false; // Flag OFF
        if (feature === 'appbuilder-image-manager') return true;
        if (feature === 'appbuilder-chat-gauge') return true;
        return false;
      });

      renderWithProviders(
        <ChatInput {...defaultProps} inputValue="" />
      );

      const textarea = screen.getByTestId('chat-input-textarea') as HTMLTextAreaElement;

      // Start with 2 lines
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 42,
      });
      triggerResize(textarea);

      // Transition to 5 lines (way over threshold)
      Object.defineProperty(textarea, 'scrollHeight', {
        configurable: true,
        value: 106,
      });
      triggerResize(textarea);

      // shouldCollapse should stay false because the feature flag is off
      expect(getLastShouldCollapse()).toBe(false);
    });

    describe('with Lexical editor and element mentions', () => {
      it('should count lines correctly with element mentions', () => {
        renderWithProviders(
          <ChatInput
            {...defaultProps}
            inputValue=""
            isMultiElementSelect={true}
            aiEditContexts={[createMockContext(1)]}
          />
        );

        // For Lexical editor, the element needs to have the id set
        const elem = document.querySelector('[data-testid="chat-input-textarea"]') as HTMLElement;
        expect(elem).toBeInTheDocument();
        elem.id = 'chat-input-textarea';

        const lexicalEditor = document.getElementById('chat-input-textarea') as HTMLElement;
        expect(lexicalEditor).toBeTruthy();

        // Mock scrollHeight for content with mentions (mentions take up space too)
        Object.defineProperty(lexicalEditor, 'scrollHeight', {
          configurable: true,
          value: 85, // ~4 lines
        });

        triggerResize(lexicalEditor);

        // Should trigger collapse when > 3 lines even with mentions
        expect(getLastShouldCollapse()).toBe(true);
      });

      it('should trigger collapse with multiline text and mentions', () => {
        renderWithProviders(
          <ChatInput
            {...defaultProps}
            inputValue=""
            isMultiElementSelect={true}
            aiEditContexts={[]}
          />
        );

        const elem = document.querySelector('[data-testid="chat-input-textarea"]') as HTMLElement;
        elem.id = 'chat-input-textarea';
        const lexicalEditor = document.getElementById('chat-input-textarea') as HTMLElement;

        // Start with 2 lines
        Object.defineProperty(lexicalEditor, 'scrollHeight', {
          configurable: true,
          value: 42,
        });
        triggerResize(lexicalEditor);

        expect(getLastShouldCollapse()).toBe(false);

        // Add mentions and more text → 4 lines
        Object.defineProperty(lexicalEditor, 'scrollHeight', {
          configurable: true,
          value: 85,
        });
        triggerResize(lexicalEditor);

        // Should trigger collapse
        expect(getLastShouldCollapse()).toBe(true);
      });

      it('should handle mentions in single line without triggering collapse', () => {
        renderWithProviders(
          <ChatInput
            {...defaultProps}
            inputValue=""
            isMultiElementSelect={true}
            aiEditContexts={[createMockContext(1, 'button')]}
          />
        );

        const elem = document.querySelector('[data-testid="chat-input-textarea"]') as HTMLElement;
        elem.id = 'chat-input-textarea';
        const lexicalEditor = document.getElementById('chat-input-textarea') as HTMLElement;

        // Single line with mention
        Object.defineProperty(lexicalEditor, 'scrollHeight', {
          configurable: true,
          value: 21, // ~1 line
        });
        triggerResize(lexicalEditor);

        // Should NOT trigger collapse (only 1 line)
        expect(getLastShouldCollapse()).toBe(false);
      });

      it('should trigger collapse when adding mentions causes overflow', () => {
        renderWithProviders(
          <ChatInput
            {...defaultProps}
            inputValue=""
            isMultiElementSelect={true}
            aiEditContexts={[]}
          />
        );

        const elem = document.querySelector('[data-testid="chat-input-textarea"]') as HTMLElement;
        elem.id = 'chat-input-textarea';
        const lexicalEditor = document.getElementById('chat-input-textarea') as HTMLElement;

        // Start with 3 lines of text, no mentions
        Object.defineProperty(lexicalEditor, 'scrollHeight', {
          configurable: true,
          value: 64, // Exactly 3 lines
        });
        triggerResize(lexicalEditor);

        expect(getLastShouldCollapse()).toBe(false);

        // Add a mention that pushes it to 4 lines
        Object.defineProperty(lexicalEditor, 'scrollHeight', {
          configurable: true,
          value: 85, // 4 lines now
        });
        triggerResize(lexicalEditor);

        // Should trigger collapse when crossing threshold
        expect(getLastShouldCollapse()).toBe(true);
      });

      it('should reset collapse trigger when removing mentions reduces lines', () => {
        renderWithProviders(
          <ChatInput
            {...defaultProps}
            inputValue=""
            isMultiElementSelect={true}
            aiEditContexts={[]}
          />
        );

        const elem = document.querySelector('[data-testid="chat-input-textarea"]') as HTMLElement;
        elem.id = 'chat-input-textarea';
        const lexicalEditor = document.getElementById('chat-input-textarea') as HTMLElement;

        // Start with 4 lines including mentions
        Object.defineProperty(lexicalEditor, 'scrollHeight', {
          configurable: true,
          value: 85,
        });
        triggerResize(lexicalEditor);

        expect(getLastShouldCollapse()).toBe(true);

        // Remove mentions, goes back to 2 lines
        Object.defineProperty(lexicalEditor, 'scrollHeight', {
          configurable: true,
          value: 42,
        });
        triggerResize(lexicalEditor);

        // Should reset collapse trigger (back to ≤3 lines)
        expect(getLastShouldCollapse()).toBe(false);
      });
    });

    describe('width resize scenarios', () => {
      it('should trigger collapse when pane width shrinks and causes text to wrap to >3 lines', async () => {
        const onInputChange = vi.fn();
        renderWithProviders(
          <ChatInput {...defaultProps} inputValue="" onInputChange={onInputChange} />
        );

        const textarea = screen.getByTestId('chat-input-textarea') as HTMLTextAreaElement;

        // Start with a long single line of text (wide pane, 2 lines visually)
        Object.defineProperty(textarea, 'scrollHeight', {
          configurable: true,
          value: 42, // 2 lines
        });

        triggerResize(textarea);

        // Verify shouldCollapse is false initially
        expect(getLastShouldCollapse()).toBe(false);

        // Simulate pane width shrinking - same text now wraps to 4 lines
        Object.defineProperty(textarea, 'scrollHeight', {
          configurable: true,
          value: 85, // 4 lines after wrapping
        });

        triggerResize(textarea);

        // Should trigger collapse (2 → 4 lines due to width change)
        expect(getLastShouldCollapse()).toBe(true);
      });

      it('should reset collapse when pane width expands and text unwraps to ≤3 lines', async () => {
        const onInputChange = vi.fn();
        renderWithProviders(
          <ChatInput {...defaultProps} inputValue="" onInputChange={onInputChange} />
        );

        const textarea = screen.getByTestId('chat-input-textarea') as HTMLTextAreaElement;

        // Start with text wrapped to 4 lines (narrow pane)
        Object.defineProperty(textarea, 'scrollHeight', {
          configurable: true,
          value: 85, // 4 lines when wrapped
        });

        triggerResize(textarea);

        // Verify shouldCollapse is true
        expect(getLastShouldCollapse()).toBe(true);

        // Simulate pane width expanding - same text now fits on 2 lines
        Object.defineProperty(textarea, 'scrollHeight', {
          configurable: true,
          value: 42, // 2 lines after unwrapping
        });

        triggerResize(textarea);

        // Should reset collapse trigger (4 → 2 lines due to width change)
        expect(getLastShouldCollapse()).toBe(false);
      });

      it('should handle rapid resize events with debouncing', async () => {
        const onInputChange = vi.fn();
        renderWithProviders(
          <ChatInput
            {...defaultProps}
            inputValue="Some text that will wrap differently"
            onInputChange={onInputChange}
          />
        );

        const textarea = screen.getByTestId('chat-input-textarea') as HTMLTextAreaElement;

        // Simulate rapid resize events (should be debounced)
        // Start at 2 lines
        Object.defineProperty(textarea, 'scrollHeight', {
          configurable: true,
          value: 42,
        });

        triggerResize(textarea);
        expect(getLastShouldCollapse()).toBe(false);

        // Resize to 3 lines
        Object.defineProperty(textarea, 'scrollHeight', {
          configurable: true,
          value: 64,
        });

        triggerResize(textarea);
        expect(getLastShouldCollapse()).toBe(false);

        // Resize to 4 lines (should trigger collapse)
        Object.defineProperty(textarea, 'scrollHeight', {
          configurable: true,
          value: 85,
        });

        triggerResize(textarea);

        // Debouncing should handle these rapid changes efficiently
        // Only the final transition (≤3 → 4) should trigger collapse
        expect(getLastShouldCollapse()).toBe(true);
      });
    });
  });
});
