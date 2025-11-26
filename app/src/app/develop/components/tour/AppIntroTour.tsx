'use client';

import { Coachmark, ProductTour, useStep } from '@ux/coachmark';

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
  const steps: TourStep[] = [
    {
      anchorId: 'tour-chat-input',
      title: 'Chat with Airo',
      description: 'Tell Airo what you want to build or modify in your app. The AI will understand your request and make the changes for you.',
    },
    {
      anchorId: 'tour-settings-button',
      title: 'App Settings',
      description: 'Access your app configuration, manage domains, databases, secrets, and other project settings.',
    },
    {
      anchorId: 'tour-select-mode-button',
      title: 'Select Mode',
      description: 'Highlight a specific part of the app to make changes or let Airo make it for you.',
    },
    {
      anchorId: 'tour-publish-button',
      title: 'Publish Your App',
      description: 'When you\'re ready, publish your app to make it live. You can deploy changes anytime with a single click.',
    },
  ];

  return (
    <ProductTour
      show={show}
      onClose={onClose}
      nextMessage="Next"
      prevMessage="Back"
      exitMessage="Got it!"
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
