import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import HeroSection from './HeroSection';

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useResponsive', () => ({
  useResponsive: () => ({ isMobile: false, isTablet: false }),
}));

vi.mock('@/app/components/HeroExamples', () => ({
  default: () => <div data-testid="hero-examples">Examples</div>,
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

describe('HeroSection', () => {
  const defaultProps = {
    promptText: '',
    setPromptText: vi.fn(),
    onStartBuilding: vi.fn(),
    isLoading: false,
    error: null,
    setError: vi.fn(),
    onExampleClick: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpeechRecognition.isListening = false;
  });

  it('should render without crashing', () => {
    renderWithProviders(<HeroSection {...defaultProps} />);

    expect(screen.getByTestId('homepage-prompt-input')).toBeInTheDocument();
  });

  it('should render hero title', () => {
    renderWithProviders(<HeroSection {...defaultProps} />);

    expect(screen.getByText('builder_homepage_hero_title')).toBeInTheDocument();
  });

  it('should call onStartBuilding when send button clicked', async function callOnStartBuilding() {
    const onStartBuilding = vi.fn();
    const { user } = renderWithProviders(
      <HeroSection {...defaultProps} promptText="Test prompt" onStartBuilding={onStartBuilding} />
    );

    const sendButton = screen.getByRole('button', { name: 'builder_homepage_hero_prompt_button' });
    await user.click(sendButton);

    await waitFor(() => {
      expect(onStartBuilding).toHaveBeenCalledOnce();
    });
  });

  it('should disable send button when prompt is empty', () => {
    renderWithProviders(<HeroSection {...defaultProps} promptText="" />);

    const sendButton = screen.getByRole('button', { name: 'builder_homepage_hero_prompt_button' });
    expect(sendButton).toBeDisabled();
  });

  it('should enable send button when prompt has value', () => {
    renderWithProviders(<HeroSection {...defaultProps} promptText="Test prompt" />);

    const sendButton = screen.getByRole('button', { name: 'builder_homepage_hero_prompt_button' });
    expect(sendButton).not.toBeDisabled();
  });

  describe('speech recognition cleanup on start building', () => {
    it('should stop speech and reset transcript when starting to build while listening', async function stopOnStartBuilding() {
      mockSpeechRecognition.isListening = true;
      const onStartBuilding = vi.fn();
      const { user } = renderWithProviders(
        <HeroSection {...defaultProps} promptText="Test prompt" onStartBuilding={onStartBuilding} />
      );

      const sendButton = screen.getByRole('button', { name: 'builder_homepage_hero_prompt_button' });
      await user.click(sendButton);

      await waitFor(() => {
        expect(mockStopSpeech).toHaveBeenCalledOnce();
        expect(mockResetTranscript).toHaveBeenCalledOnce();
        expect(onStartBuilding).toHaveBeenCalledOnce();
      });
    });

    it('should not call stop or reset when starting to build while not listening', async function noCleanupWhenNotListening() {
      mockSpeechRecognition.isListening = false;
      const onStartBuilding = vi.fn();
      const { user } = renderWithProviders(
        <HeroSection {...defaultProps} promptText="Test prompt" onStartBuilding={onStartBuilding} />
      );

      const sendButton = screen.getByRole('button', { name: 'builder_homepage_hero_prompt_button' });
      await user.click(sendButton);

      await waitFor(() => {
        expect(onStartBuilding).toHaveBeenCalledOnce();
      });
      expect(mockStopSpeech).not.toHaveBeenCalled();
      expect(mockResetTranscript).not.toHaveBeenCalled();
    });
  });

  describe('error display', () => {
    it('should display error when provided', () => {
      renderWithProviders(<HeroSection {...defaultProps} error="Something went wrong" />);

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('should not display error when null', () => {
      renderWithProviders(<HeroSection {...defaultProps} error={null} />);

      expect(screen.queryByText('builder_status_error')).not.toBeInTheDocument();
    });
  });
});
