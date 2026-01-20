import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import { MediaType } from '@/app/develop/components/chat/AssetManagerModal';
import ChatInput from './ChatInput';

const mockDevelopStore = {
  isMobile: false,
  isAssetManagerOpen: false,
  setIsAssetManagerOpen: vi.fn(),
};

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));
vi.mock('@/stores/useDevelopPageStore', () => ({
  useDevelopPageStore: (selector: any) => selector(mockDevelopStore),
}));
vi.mock('@/hooks/useSwitchboard', () => ({
  useSwitchboard: (feature: string) => {
    if (feature === 'appbuilder-image-manager') return { data: true };
    return { data: false };
  },
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

  it('should render media button', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'builder_chat_toolbar_button_media' })).toBeInTheDocument();
  });

  it('should disable media button when disabled', () => {
    renderWithProviders(<ChatInput {...defaultProps} isDisabled={true} />);

    const mediaButton = screen.getByRole('button', { name: 'builder_chat_toolbar_button_media' });
    expect(mediaButton).toBeDisabled();
  });

  it('should have correct media button data-eid attribute', () => {
    renderWithProviders(<ChatInput {...defaultProps} />);

    const mediaButton = screen.getByRole('button', { name: 'builder_chat_toolbar_button_media' });
    expect(mediaButton).toHaveAttribute('data-eid', 'develop.chat_toolbar.medias');
  });

  it('should render media button on desktop even when asset manager disabled', () => {
    mockDevelopStore.isMobile = false;

    renderWithProviders(<ChatInput {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'builder_chat_toolbar_button_media' })).toBeInTheDocument();
  });

  it('should disable media button when selectedAssets length equals maxAssets', function disableAtLimit() {
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
        selectedAssets={assetsAtLimit}
        maxAssets={maxAssets}
        onClearSelectedAsset={vi.fn()}
      />
    );

    const mediaButton = screen.getByRole('button', { name: 'builder_chat_toolbar_button_media' });
    expect(mediaButton).toBeDisabled();
  });

  it('should enable media button when selectedAssets length is less than maxAssets', function enableBelowLimit() {
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
        selectedAssets={assetsBelowLimit}
        maxAssets={maxAssets}
        onClearSelectedAsset={vi.fn()}
      />
    );

    const mediaButton = screen.getByRole('button', { name: 'builder_chat_toolbar_button_media' });
    expect(mediaButton).not.toBeDisabled();
  });
});
