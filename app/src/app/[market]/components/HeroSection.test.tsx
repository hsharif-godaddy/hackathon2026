/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import HeroSection from './HeroSection';

const mockLogEngagementMetric = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({ cohort: 'test-cohort', logAnalytics: mockLogEngagementMetric }),
}));

vi.mock('@/utils/instrumentation', () => ({
  generateClickEID: vi.fn((id) => id),
}));

vi.mock('@/hooks/useTranslations', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/hooks/useBreakpoints', () => ({
  useBreakpoints: () => ({ isBelowSmBreakpoint: false, isMdBreakpoint: false }),
}));

vi.mock('@/app/[market]/components/HeroExamples', () => ({
  default: () => <div data-testid="hero-examples">Examples</div>,
}));

vi.mock('@/components/providers/AuthProvider', () => ({
  useAuthContext: () => ({
    isAuthenticated: false,
    isLoading: false,
  }),
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
    selectedTemplate: 'default',
    onTemplateChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpeechRecognition.isListening = false;
    mockLogEngagementMetric.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('should insert a newline and not submit when Cmd+Enter pressed', async () => {
    const onStartBuilding = vi.fn();
    const { user } = renderWithProviders(
      <HeroSection {...defaultProps} promptText="Test prompt" onStartBuilding={onStartBuilding} />
    );

    const textarea = screen.getByTestId('homepage-prompt-input');
    await user.click(textarea);
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    await waitFor(() => {
      expect(textarea).toHaveValue('Test prompt\n');
    });
    expect(onStartBuilding).not.toHaveBeenCalled();
  });

  it('should insert a newline and not submit when Alt+Enter pressed', async () => {
    const onStartBuilding = vi.fn();
    const { user } = renderWithProviders(
      <HeroSection {...defaultProps} promptText="Test prompt" onStartBuilding={onStartBuilding} />
    );

    const textarea = screen.getByTestId('homepage-prompt-input');
    await user.click(textarea);
    await user.keyboard('{Alt>}{Enter}{/Alt}');

    await waitFor(() => {
      expect(textarea).toHaveValue('Test prompt\n');
    });
    expect(onStartBuilding).not.toHaveBeenCalled();
  });

  describe('engagement metrics', () => {
    it('logs homepage.prompt.focus on first textarea focus', async function focusMetric() {
      renderWithProviders(<HeroSection {...defaultProps} />);

      fireEvent.focus(screen.getByTestId('homepage-prompt-input'));

      await waitFor(() => {
        expect(mockLogEngagementMetric).toHaveBeenCalledWith(
          'homepage.prompt.focus',
          expect.objectContaining({ msFromPageLoad: expect.any(Number) }),
          expect.anything(),
        )
      });
    });

    it('invokes analytics once with action eid on first prompt textarea focus', async function promptInputFocus() {
      renderWithProviders(<HeroSection {...defaultProps} />);
      const input = screen.getByTestId('homepage-prompt-input');

      fireEvent.focus(input);

      expect(mockLogEngagementMetric).toHaveBeenCalledTimes(1);
      expect(mockLogEngagementMetric).toHaveBeenCalledWith(
        'homepage.prompt.focus',
        expect.objectContaining({ msFromPageLoad: expect.any(Number) }),
        {
          kind: 'action',
          eid: 'homepage.prompt.input',
          action: 'focus',
        },
      );
      mockLogEngagementMetric.mockClear();

      fireEvent.focus(input);
      expect(mockLogEngagementMetric).not.toHaveBeenCalled();
    });

    it('logs homepage.prompt.first_input on first change', async function firstInputMetric() {
      renderWithProviders(<HeroSection {...defaultProps} />);

      fireEvent.change(screen.getByTestId('homepage-prompt-input'), { target: { value: 'a' } });

      await waitFor(() => {
        expect(mockLogEngagementMetric).toHaveBeenCalledWith(
          'homepage.prompt.first_input',
          expect.objectContaining({ msFromPageLoad: expect.any(Number) }),
        );
      });
    });

    it('logs homepage.prompt.cleared when user clears non-empty text', async function clearedMetric() {
      renderWithProviders(<HeroSection {...defaultProps} />);

      const input = screen.getByTestId('homepage-prompt-input');
      fireEvent.change(input, { target: { value: 'hello' } });
      mockLogEngagementMetric.mockClear();
      fireEvent.change(input, { target: { value: '' } });

      expect(mockLogEngagementMetric).toHaveBeenCalledWith('homepage.prompt.cleared', {
        previousLength: 5,
        msFromFirstInput: expect.any(Number),
      });
    });

    it('logs homepage.prompt.speech_toggled when mic is clicked', async function speechMetric() {
      const { user } = renderWithProviders(<HeroSection {...defaultProps} />);

      const mic = screen.getByRole('button', { name: /Start voice input/i });
      await user.click(mic);

      expect(mockLogEngagementMetric).toHaveBeenCalledWith('homepage.prompt.speech_toggled', { active: true });
    });

    it('logs homepage.prompt.idle after 30s with content and no further input', async function idleMetric() {
      vi.useFakeTimers();
      renderWithProviders(<HeroSection {...defaultProps} />);

      fireEvent.change(screen.getByTestId('homepage-prompt-input'), { target: { value: 'hello' } });

      await vi.advanceTimersByTimeAsync(30_000);

      expect(mockLogEngagementMetric).toHaveBeenCalledWith('homepage.prompt.idle', {
        promptLength: 5,
      });
    });

    it('does not log homepage.prompt.idle before 30s', async function idleNotEarly() {
      vi.useFakeTimers();
      renderWithProviders(<HeroSection {...defaultProps} />);

      fireEvent.change(screen.getByTestId('homepage-prompt-input'), { target: { value: 'x' } });
      mockLogEngagementMetric.mockClear();

      await vi.advanceTimersByTimeAsync(25_000);
      expect(
        mockLogEngagementMetric.mock.calls.some(([name]) => name === 'homepage.prompt.idle'),
      ).toBe(false);
    });

    it('logs homepage.prompt.abandoned when tab hidden after typing', async function abandonedMetric() {
      renderWithProviders(<HeroSection {...defaultProps} />);

      fireEvent.change(screen.getByTestId('homepage-prompt-input'), { target: { value: 'hello' } });
      mockLogEngagementMetric.mockClear();

      const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      fireEvent(document, new Event('visibilitychange'));

      await waitFor(() => {
        expect(mockLogEngagementMetric).toHaveBeenCalledWith(
          'homepage.prompt.abandoned',
          expect.objectContaining({
            promptLength: 5,
            msFromFirstInput: expect.any(Number),
            msFromPageLoad: expect.any(Number),
          }),
        );
      });

      if (originalVisibility) {
        Object.defineProperty(document, 'visibilityState', originalVisibility);
      } else {
        delete (document as { visibilityState?: string }).visibilityState;
      }
    });
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

  describe('template selector', () => {
    it('should render template selector as a labelled group when onTemplateChange provided', () => {
      renderWithProviders(<HeroSection {...defaultProps} />);

      const group = screen.getByRole('group', { name: 'builder_homepage_template_label' });
      expect(group).toBeInTheDocument();
      const chips = screen.getAllByRole('checkbox');
      expect(chips).toHaveLength(3);
    });

    it('should not render template selector when onTemplateChange is undefined', () => {
      renderWithProviders(<HeroSection {...defaultProps} onTemplateChange={undefined} />);

      expect(
        screen.queryByRole('group', { name: 'builder_homepage_template_label' })
      ).not.toBeInTheDocument();
    });

    it('should mark default template as checked', () => {
      renderWithProviders(<HeroSection {...defaultProps} selectedTemplate="default" />);

      const chips = screen.getAllByRole('checkbox');
      expect(chips[0]).toBeChecked();
      expect(chips[1]).not.toBeChecked();
      expect(chips[2]).not.toBeChecked();
    });

    it('should call onTemplateChange when clicking a template', async () => {
      const onTemplateChange = vi.fn();
      const { user } = renderWithProviders(
        <HeroSection {...defaultProps} onTemplateChange={onTemplateChange} />
      );

      const chips = screen.getAllByRole('checkbox');
      await user.click(chips[1]);
      expect(onTemplateChange).toHaveBeenCalledWith('business-plan');
    });
  });
});
