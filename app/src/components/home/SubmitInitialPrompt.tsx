'use client';

import { type ReactNode } from 'react';
import Button from '@ux/button';
import Spinner from '@ux/spinner';

import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';

export interface SubmitInitialPromptProps {
  onClick: () => void;
  disabled: boolean;
  isLoading: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export function SubmitInitialPrompt({
  onClick,
  disabled,
  isLoading,
  icon = null,
  children,
}: SubmitInitialPromptProps) {
  const t = useTranslations();
  const { isBelowSmBreakpoint } = useBreakpoints();

  return (
    <Button
      onClick={onClick}
      data-partial="componentAiro"
      data-eid={generateClickEID('homepage.prompt.submit')}
      disabled={disabled}
      design="primary"
      className={`cursor-pointer !rounded-full !border-none${children ? '' : ' aspect-square'}`}
      icon={isLoading ? <Spinner size="sm" /> : icon}
      size={isBelowSmBreakpoint ? 'sm' : 'md'}
      aria-label={
        isLoading
          ? t('builder_homepage_hero_prompt_button_loading')
          : t('builder_homepage_hero_prompt_button')
      }
    >
      {children}
    </Button>
  );
}
