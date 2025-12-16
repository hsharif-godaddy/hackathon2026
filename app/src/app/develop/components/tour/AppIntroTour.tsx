'use client';

import { Coachmark, ProductTour, useStep } from '@ux/coachmark';

import { useTranslations } from '@/hooks/useTranslations'

/**
 * Tour step configuration interface
 */
interface TourStep {
  /** ID of the element to anchor the coachmark to */
  anchorId: string;
  /** Step title */
  title: string;
  /** Step description */
  description: string;
}

/**
 * Props for the AppIntroTour component
 */
interface AppIntroTourProps {
  /** Whether the tour should be displayed */
  show: boolean;
  /** Callback when the tour is closed */
  onClose: () => void;
}

/**
 * Individual coachmark step component that uses the useStep hook
 *
 * @param props - Step configuration
 * @returns The coachmark component
 */
function TourStep({ anchorId, title, description }: TourStep) {
  const stepState = useStep({ anchorId });

  return (
    <Coachmark
      anchorId={anchorId}
      title={title}
      description={description}
      show={stepState.show}
      currentStep={stepState.currentStep}
      totalSteps={stepState.totalSteps}
      nextMessage={stepState.nextMessage || 'Next'}
      prevMessage={stepState.prevMessage || 'Back'}
      onClose={stepState.onClose}
    />
  );
}

/**
 * Guided tour component for the develop page
 *
 * Highlights key features including ChatInput, Select Mode, Settings, and Publish button.
 * Uses the UXCore ProductTour and Coachmark components.
 *
 * @param props - Component props
 * @returns The guided tour component
 */
export function AppIntroTour({ show, onClose }: AppIntroTourProps) {
  const t = useTranslations();

  const steps: TourStep[] = [
    {
      anchorId: 'tour-chat-input',
      title: t('builder_tour_intro_tour-chat-input_title'),
      description: t('builder_tour_intro_tour-chat-input_description'),
    },
    {
      anchorId: 'tour-settings-button',
      title: t('builder_tour_intro_tour-settings-button_title'),
      description: t('builder_tour_intro_tour-settings-button_description'),
    },
    {
      anchorId: 'tour-select-mode-button',
      title: t('builder_tour_intro_tour-select-mode-button_title'),
      description: t('builder_tour_intro_tour-select-mode-button_description'),
    },
    {
      anchorId: 'tour-publish-button',
      title: t('builder_tour_intro_tour-publish-button_title'),
      description: t('builder_tour_intro_tour-publish-button_description'),
    },
  ];

  return (
    <ProductTour
      show={show}
      onClose={onClose}
      nextMessage={t('builder_tour_next')}
      prevMessage={t('builder_tour_back')}
      exitMessage={t('builder_tour_exit')}
    >
      {steps.map((step, index) => (
        <TourStep
          key={index}
          {...step}
        />
      ))}
    </ProductTour>
  );
}
