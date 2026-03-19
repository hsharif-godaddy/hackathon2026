import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { MediaType } from '@/app/develop/components/chat/AssetTypes';
import { renderWithProviders } from '@/tests/test-utils';
import ChatInput from './ChatInput';

const mockDevelopStore = {
  isMobile: false,
  isAssetManagerOpen: false,
  setIsAssetManagerOpen: vi.fn(),
  openUpgradeModal: vi.fn(),
};

const mockUseSwitchboard = vi.hoisted(() => vi.fn((feature: string) => {
  if (feature === 'appbuilder-image-manager') {return { data: true };}
  if (feature === 'appbuilder-chat-gauge') {return { data: true };}
  return { data: false };
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: mockUseSwitchboard,
}));
vi.mock('@/hooks/useDailyUsage', () => ({
  useDailyUsage: () => ({
    data: { percentage: 50, used: 50, limit: 100 },
    isLoading: false,
    formattedResetTime: { dayKey: 'today', timeString: '12:00 PM' },
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
      if (feature === 'appbuilder-image-manager') {return { data: true };}
      if (feature === 'appbuilder-chat-gauge') {return { data: true };}
      return { data: false };
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

  it('should enable send button when input has value', () => {
    renderWithProviders(<ChatInput {...defaultProps} inputValue="Test" />);

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    expect(sendButton).not.toBeDisabled();
  });

  it('should disable send button when isDisabled is true', () => {
    renderWithProviders(<ChatInput {...defaultProps} inputValue="Test" isDisabled={true} />);

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    expect(sendButton).toBeDisabled();
  });

  it('should disable send button while files are uploading', () => {
    const uploadingFiles = [{ id: 'upload-1', name: 'photo.jpg' }];
    renderWithProviders(
      <ChatInput {...defaultProps} inputValue="Test" uploadingFiles={uploadingFiles} />
    );

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    expect(sendButton).toBeDisabled();
  });

  it('should not call onSendMessage via Enter key while files are uploading', async () => {
    const onSendMessage = vi.fn();
    const uploadingFiles = [{ id: 'upload-1', name: 'photo.jpg' }];
    const { user } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        inputValue="Test"
        onSendMessage={onSendMessage}
        uploadingFiles={uploadingFiles}
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
      <ChatInput {...defaultProps} inputValue="Test" onSendMessage={onSendMessage} />
    );

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    await user.click(sendButton);

    await waitFor(() => {
      expect(onSendMessage).toHaveBeenCalledOnce();
    });
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

  it('should have correct textarea attributes', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('id', 'chat-input-textarea');
    expect(textarea).toHaveAttribute('rows', '3');
  });

  it('should have correct send button attributes', () => {
    renderWithProviders(<ChatInput {...defaultProps} inputValue="Test" />);

    const sendButton = screen.getByRole('button', { name: 'builder_chatinput_send' });
    expect(sendButton).toHaveAttribute('id', 'chat-send-button');
    expect(sendButton).toHaveAttribute('data-eid', 'develop.prompt.send');
  });

  it('should render attachment menu when appId and onFilesUploaded provided', () => {
    const { container } = renderWithProviders(
      <ChatInput {...defaultProps} appId="test-app-123" onFilesUploaded={vi.fn()} />
    );

    const attachmentButton = container.querySelector('[data-eid="develop.chat_input.attachment_menu"]');
    expect(attachmentButton).toBeInTheDocument();
  });

  it('should not render attachment menu when appId is not provided', () => {
    const { container } = renderWithProviders(<ChatInput {...defaultProps} />);

    const attachmentButton = container.querySelector('[data-eid="develop.chat_input.attachment_menu"]');
    expect(attachmentButton).not.toBeInTheDocument();
  });

  it('should not render attachment menu when onFilesUploaded is not provided', () => {
    const { container } = renderWithProviders(<ChatInput {...defaultProps} appId="test-app-123" />);

    const attachmentButton = container.querySelector('[data-eid="develop.chat_input.attachment_menu"]');
    expect(attachmentButton).not.toBeInTheDocument();
  });

  it('should disable attachment menu button when disabled', () => {
    const { container } = renderWithProviders(
      <ChatInput {...defaultProps} appId="test-app-123" onFilesUploaded={vi.fn()} isDisabled={true} />
    );

    const attachmentButton = container.querySelector('[data-eid="develop.chat_input.attachment_menu"]');
    expect(attachmentButton).toBeDisabled();
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

    const { container } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        appId="test-app-123"
        onFilesUploaded={vi.fn()}
        selectedAssets={assetsAtLimit}
        maxAssets={maxAssets}
        onClearSelectedAsset={vi.fn()}
      />
    );

    const attachmentButton = container.querySelector('[data-eid="develop.chat_input.attachment_menu"]');
    expect(attachmentButton).toBeDisabled();
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

    const { container } = renderWithProviders(
      <ChatInput
        {...defaultProps}
        appId="test-app-123"
        onFilesUploaded={vi.fn()}
        selectedAssets={assetsBelowLimit}
        maxAssets={maxAssets}
        onClearSelectedAsset={vi.fn()}
      />
    );

    const attachmentButton = container.querySelector('[data-eid="develop.chat_input.attachment_menu"]');
    expect(attachmentButton).not.toBeDisabled();
  });

  describe('UsageGauge feature flag', () => {
    it('should render UsageGauge when feature flag is enabled', () => {
      mockUseSwitchboard.mockImplementation((feature: string) => {
        if (feature === 'appbuilder-image-manager') {return { data: true };}
        if (feature === 'appbuilder-chat-gauge') {return { data: true };}
        return { data: false };
      });

      renderWithProviders(<ChatInput {...defaultProps} appId="test-app-123" />);

      expect(screen.getByRole('button', { name: /builder_usage_gauge_aria_label/i })).toBeInTheDocument();
    });

    it('should not render UsageGauge when feature flag is disabled', () => {
      mockUseSwitchboard.mockImplementation((feature: string) => {
        if (feature === 'appbuilder-image-manager') {return { data: true };}
        if (feature === 'appbuilder-chat-gauge') {return { data: false };}
        return { data: false };
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
      const { container } = renderWithProviders(
        <ChatInput {...defaultProps} appId="test-app-123" onFilesUploaded={vi.fn()} isBudgetExceeded={true} />
      );

      const attachmentButton = container.querySelector('[data-eid="develop.chat_input.attachment_menu"]');
      expect(attachmentButton).toBeDisabled();
    });

    it('should disable speech button when isBudgetExceeded is true', () => {
      renderWithProviders(<ChatInput {...defaultProps} isBudgetExceeded={true} />);

      const speechButton = screen.getByRole('button', { name: '' });
      expect(speechButton).toBeDisabled();
    });

    it('should prioritize budget exceeded placeholder over processing placeholder', () => {
      renderWithProviders(<ChatInput {...defaultProps} isDisabled={true} isBudgetExceeded={true} />);

      expect(screen.getByPlaceholderText('builder_chatinput_budget_exceeded')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('builder_chatinput_processing')).not.toBeInTheDocument();
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
