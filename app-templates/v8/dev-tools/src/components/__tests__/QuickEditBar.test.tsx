/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { createElement } from 'react';
import { QuickEditBar } from '../QuickEditBar';

vi.mock('../../utils/translations', () => ({
  t: vi.fn((_: string, fallback: string) => fallback),
}));

interface SpeechController {
  isSupported: boolean;
  isListening: boolean;
  transcript: string;
  toggle: () => void;
}

function makeSpeech(overrides: Partial<SpeechController> = {}): SpeechController {
  return {
    isSupported: true,
    isListening: false,
    transcript: '',
    toggle: vi.fn(),
    ...overrides,
  };
}

function getMicButton(): HTMLButtonElement | null {
  return document.querySelector('button[aria-pressed]') as HTMLButtonElement | null;
}

function getInput(): HTMLInputElement {
  const input = document.querySelector('input[type="text"]') as HTMLInputElement | null;
  if (!input) throw new Error('input not found');
  return input;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('QuickEditBar', () => {
  describe('mic button rendering', () => {
    it('does not render mic button when speech prop is omitted', () => {
      render(
        createElement(QuickEditBar, {
          onSubmit: vi.fn(),
          onDismiss: vi.fn(),
        }),
      );
      expect(getMicButton()).toBeNull();
    });

    it('does not render mic button when speech.isSupported is false', () => {
      render(
        createElement(QuickEditBar, {
          onSubmit: vi.fn(),
          onDismiss: vi.fn(),
          speech: makeSpeech({ isSupported: false }),
        }),
      );
      expect(getMicButton()).toBeNull();
    });

    it('renders mic button when speech.isSupported is true', () => {
      render(
        createElement(QuickEditBar, {
          onSubmit: vi.fn(),
          onDismiss: vi.fn(),
          speech: makeSpeech({ isSupported: true }),
        }),
      );
      const mic = getMicButton();
      expect(mic).not.toBeNull();
      expect(mic!.title).toMatch(/Start listening|Stop listening/);
    });
  });

  describe('mic button title and aria-pressed', () => {
    it('reflects isListening=false: "Start listening" and aria-pressed=false', () => {
      render(
        createElement(QuickEditBar, {
          onSubmit: vi.fn(),
          onDismiss: vi.fn(),
          speech: makeSpeech({ isListening: false }),
        }),
      );
      const mic = getMicButton()!;
      expect(mic.title).toBe('Start listening');
      expect(mic.getAttribute('aria-pressed')).toBe('false');
    });

    it('reflects isListening=true: "Stop listening" and aria-pressed=true', () => {
      render(
        createElement(QuickEditBar, {
          onSubmit: vi.fn(),
          onDismiss: vi.fn(),
          speech: makeSpeech({ isListening: true }),
        }),
      );
      const mic = getMicButton()!;
      expect(mic.title).toBe('Stop listening');
      expect(mic.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('mic button click', () => {
    it('calls speech.toggle() when clicked', () => {
      const speech = makeSpeech();
      render(
        createElement(QuickEditBar, {
          onSubmit: vi.fn(),
          onDismiss: vi.fn(),
          speech,
        }),
      );
      fireEvent.click(getMicButton()!);
      expect(speech.toggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('transcript application', () => {
    it('appends transcript to existing baseText with separator space', () => {
      const onSubmit = vi.fn();
      const onDismiss = vi.fn();
      const speech1 = makeSpeech({ isListening: false, transcript: '' });
      const { rerender } = render(
        createElement(QuickEditBar, { onSubmit, onDismiss, speech: speech1 }),
      );

      // Type baseText
      fireEvent.change(getInput(), { target: { value: 'make it' } });
      expect(getInput().value).toBe('make it');

      // Start listening (captures baseRef = "make it")
      rerender(
        createElement(QuickEditBar, {
          onSubmit,
          onDismiss,
          speech: makeSpeech({ isListening: true, transcript: '' }),
        }),
      );

      // Transcript arrives
      rerender(
        createElement(QuickEditBar, {
          onSubmit,
          onDismiss,
          speech: makeSpeech({ isListening: true, transcript: 'bigger' }),
        }),
      );

      expect(getInput().value).toBe('make it bigger');
    });

    it('does not add leading space when baseText is empty', () => {
      const onSubmit = vi.fn();
      const onDismiss = vi.fn();
      const { rerender } = render(
        createElement(QuickEditBar, {
          onSubmit,
          onDismiss,
          speech: makeSpeech({ isListening: false, transcript: '' }),
        }),
      );

      // Start listening with empty baseText
      rerender(
        createElement(QuickEditBar, {
          onSubmit,
          onDismiss,
          speech: makeSpeech({ isListening: true, transcript: '' }),
        }),
      );

      // Transcript arrives
      rerender(
        createElement(QuickEditBar, {
          onSubmit,
          onDismiss,
          speech: makeSpeech({ isListening: true, transcript: 'hello' }),
        }),
      );

      expect(getInput().value).toBe('hello');
    });
  });

  describe('submit while listening', () => {
    it('Enter key calls speech.toggle() and onSubmit(prompt)', () => {
      const onSubmit = vi.fn();
      const onDismiss = vi.fn();
      const speech = makeSpeech({ isListening: true });
      render(
        createElement(QuickEditBar, { onSubmit, onDismiss, speech }),
      );

      const input = getInput();
      fireEvent.change(input, { target: { value: 'do the thing' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(speech.toggle).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith('do the thing');
    });
  });

  describe('keyboard event isolation', () => {
    // The bar renders into the same document as the customer app. Slide decks
    // and similar apps bind global keydown/keyup handlers (arrow keys → next
    // slide, space → advance). Keystrokes typed into the prompt must never
    // reach those host listeners. See AIROBUILD-2018.
    it('does not propagate keydown to document-level host listeners', () => {
      const hostKeydown = vi.fn();
      document.addEventListener('keydown', hostKeydown);
      try {
        render(
          createElement(QuickEditBar, { onSubmit: vi.fn(), onDismiss: vi.fn() }),
        );
        fireEvent.keyDown(getInput(), { key: 'ArrowRight' });
        expect(hostKeydown).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', hostKeydown);
      }
    });

    it('does not propagate keyup to document-level host listeners', () => {
      const hostKeyup = vi.fn();
      document.addEventListener('keyup', hostKeyup);
      try {
        render(
          createElement(QuickEditBar, { onSubmit: vi.fn(), onDismiss: vi.fn() }),
        );
        fireEvent.keyUp(getInput(), { key: ' ' });
        expect(hostKeyup).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keyup', hostKeyup);
      }
    });

    it('still handles Enter for submit even though propagation is stopped', () => {
      const onSubmit = vi.fn();
      const hostKeydown = vi.fn();
      document.addEventListener('keydown', hostKeydown);
      try {
        render(
          createElement(QuickEditBar, { onSubmit, onDismiss: vi.fn() }),
        );
        const input = getInput();
        fireEvent.change(input, { target: { value: 'make it bigger' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSubmit).toHaveBeenCalledWith('make it bigger');
        expect(hostKeydown).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', hostKeydown);
      }
    });
  });

  describe('dismiss while listening', () => {
    it('clicking X button calls speech.toggle() and onDismiss()', () => {
      const onSubmit = vi.fn();
      const onDismiss = vi.fn();
      const speech = makeSpeech({ isListening: true });
      render(
        createElement(QuickEditBar, { onSubmit, onDismiss, speech }),
      );

      // X button is the one with title="Dismiss"
      const dismissBtn = document.querySelector('button[title="Dismiss"]') as HTMLButtonElement;
      expect(dismissBtn).not.toBeNull();
      fireEvent.click(dismissBtn);

      expect(speech.toggle).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('Escape key calls speech.toggle() and onDismiss()', () => {
      const onSubmit = vi.fn();
      const onDismiss = vi.fn();
      const speech = makeSpeech({ isListening: true });
      render(
        createElement(QuickEditBar, { onSubmit, onDismiss, speech }),
      );

      fireEvent.keyDown(getInput(), { key: 'Escape' });

      expect(speech.toggle).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledTimes(1);
    });
  });
});
