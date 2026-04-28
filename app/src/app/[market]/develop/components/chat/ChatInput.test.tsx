/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { MediaType } from '@/app/[market]/develop/components/chat/AssetTypes';
import { renderWithProviders } from '@/tests/test-utils';
import { logClickEvent } from '@/utils/instrumentation';
import ChatInput from './ChatInput';

const mockDevelopStore = {
  isMobile: false,
  isAssetManagerOpen: false,
  setIsAssetManagerOpen: vi.fn(),
  openUpgradeModal: vi.fn(),
  openCreditsModal: vi.fn(),
};

const mockUseSwitchboard = vi.hoisted(() => vi.fn((feature: string) => {
  if (feature === 'appbuilder-image-manager') return true;
  if (feature === 'appbuilder-chat-gauge') return true;
  return false;
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id: string) => id),
  logClickEvent: vi.fn(() => vi.fn()),
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
    mockUseSwitchboard.mockImplementation((feature: string) => {
      if (feature === 'appbuilder-image-manager') return true;
      if (feature === 'appbuilder-chat-gauge') return true;
      return false;
    });
  });

  it('should render without crashing', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('should display textarea with placeholder', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    const textarea = screen.getByPlaceholderText('builder_chatinput_ask_airo');
    expect(textarea).toBeInTheDocument();
  });

  it('should display processing placeholder when disabled', () => {
    renderWithProviders(<ChatInput {...defaultProps} isDisabled={true} />);

    expect(screen.getByPlaceholderText('builder_chatinput_processing')).toBeInTheDocument();
  });

  it('should display input value', () => {
    renderWithProviders(<ChatInput {...defaultProps} inputValue="Test message" />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('Test message');
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

  it('should disable send when staged files exist without message text', () => {
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

    expect(screen.getByTestId('chat-send-button')).toBeDisabled();
  });

  it('should disable send when only selectedAssets present without text', () => {
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

    expect(screen.getByTestId('chat-send-button')).toBeDisabled();
  });

  it('should disable send button when input is empty even if referenced files are present', () => {
    renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue=""
        referencedFiles={[{ path: 'src/pasted.txt', content: 'pasted body' }]}
      />
    );

    expect(screen.getByRole('button', { name: 'builder_chatinput_send' })).toBeDisabled();
  });

  it('should not call onSendMessage via Enter when input is empty even if referenced files are present', async function sendWithRefsOnly() {
    const onSendMessage = vi.fn();
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue=""
        onSendMessage={onSendMessage}
        referencedFiles={[{ path: 'src/pasted.txt', content: 'pasted body' }]}
      />
    );

    const textarea = screen.getByRole('textbox');
    await user.click(textarea);
    await user.keyboard('{Enter}');

    expect(onSendMessage).not.toHaveBeenCalled();
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
    expect(stopButton).toBeDisabled();
    expect(screen.queryByTestId('chat-send-button')).not.toBeInTheDocument();
  });

  // fireEvent.click bypasses the native `disabled` attribute (unlike user-event's
  // click which respects it), so this verifies the JS-level `if (!isStreaming) return`
  // guard inside onClick — the second line of defense if a future button wrapper
  // ever fails to forward `disabled` to the underlying <button>.
  it('should not call onStopGeneration when the disabled stop button is force-clicked while not streaming', () => {
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
    expect(textarea).toBeDisabled();
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
    expect(onInputChange).toHaveBeenCalledWith('Test\n');
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
    expect(onInputChange).toHaveBeenCalledWith('Test\n');
  });

  it('should have correct textarea attributes', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('id', 'chat-input-textarea');
    expect(textarea).toHaveAttribute('rows', '3');
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

  describe('UsageGauge feature flag', () => {
    it('should render UsageGauge when feature flag is enabled', () => {
      mockUseSwitchboard.mockImplementation((feature: string) => {
        if (feature === 'appbuilder-image-manager') return true;
        if (feature === 'appbuilder-chat-gauge') return true;
        return false;
      });

      renderWithProviders(<ChatInput {...defaultProps} appId="test-app-123" />);

      expect(screen.getByRole('button', { name: /builder_usage_gauge_aria_label/i })).toBeInTheDocument();
    });

    it('should not render UsageGauge when feature flag is disabled', () => {
      mockUseSwitchboard.mockImplementation((feature: string) => {
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

      expect(screen.getByPlaceholderText('builder_chatinput_budget_exceeded')).toBeInTheDocument();
    });

    it('should disable textarea when isBudgetExceeded is true', () => {
      renderWithProviders(<ChatInput {...defaultProps} isBudgetExceeded={true} />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
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

      expect(screen.getByPlaceholderText('builder_chatinput_budget_exceeded')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('builder_chatinput_processing')).not.toBeInTheDocument();
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

  describe('speech recognition', () => {
    it('should disable textarea when listening', function disableTextareaWhileListening() {
      mockSpeechRecognition.isListening = true;
      renderWithProviders(<ChatInput {...defaultProps} inputValue="Test" />);

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
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
});
