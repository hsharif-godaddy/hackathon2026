'use client';

import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import Button from '@ux/button';
import MicIcon from '@ux/icon/mic';

import { useBreakpoints } from '@/hooks/useBreakpoints';
import { generateClickEID } from '@/utils/instrumentation';

export interface SpeechToggleButtonProps {
  isListening: boolean;
  isLoading: boolean;
  isTyping: boolean;
  onToggle: () => void;
}

export function SpeechToggleButton({
  isListening,
  isLoading,
  isTyping,
  onToggle,
}: SpeechToggleButtonProps) {
  const intl = useIntl();
  const { isBelowSmBreakpoint } = useBreakpoints();

  // Memoize aria-label to prevent translation errors on every render (20-33 times/second due to placeholder animation)
  // Use intl.formatMessage directly as intl instance is stable (unlike t which is recreated each render)
  const ariaLabel = useMemo(() => {
    return isListening
      ? intl.formatMessage({
          id: 'builder_homepage_hero_stop_listening',
          defaultMessage: 'Stop listening',
        })
      : intl.formatMessage({
          id: 'builder_homepage_hero_start_listening',
          defaultMessage: 'Start voice input',
        });
  }, [isListening, intl]);

  return (
    <Button
      onClick={onToggle}
      onMouseDown={(e) => e.preventDefault()}
      data-eid={generateClickEID('homepage.prompt.speech')}
      disabled={isLoading || isTyping}
      design={isListening ? 'primary' : 'tertiary'}
      className={
        isListening
          ? '!bg-intents-ux-feedbackHighContrastCritical-feedbackColor !border-transparent'
          : undefined
      }
      icon={<MicIcon />}
      aria-label={ariaLabel}
      size={isBelowSmBreakpoint ? 'sm' : 'md'}
      data-partial="componentAiro"
    />
  );
}
