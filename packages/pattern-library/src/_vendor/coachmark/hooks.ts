import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import ProductTourContext from './context';

interface UseTourStateProps {
  initialStep?: number;
}

export interface StepState {
  show: boolean;
  index: number;
  currentStep: number;
  totalSteps: number;
  nextStep: () => void;
  prevStep: () => void;
  nextMessage: ReactNode | null;
  prevMessage: ReactNode | null;
  onClose: () => void;
}

interface UseStepProps {
  anchorId: string;
  show?: boolean;
  onClose?: () => void;
  nextMessage?: ReactNode;
  prevMessage?: ReactNode;
  exitMessage?: ReactNode;
}

export function useTourState({ initialStep = 0 }: UseTourStateProps) {
  const [steps, setSteps] = useState<{ anchorId: string }[]>([]);
  const [currentStep, setCurrentStep] = useState(initialStep);

  const addStep = useCallback(function createStep(step: { anchorId: string }) {
    setSteps(function checkPrevious(prev) {
      if (prev.some(function check(item) {
        return item.anchorId === step.anchorId;
      })) {
        return prev;
      }
      return [...prev, step];
    });
  }, []);

  const nextStep = useCallback(
    function increment() {
      setCurrentStep(function update(prev) {
        return prev < steps.length - 1 ? prev + 1 : prev;
      });
    },
    [steps.length],
  );

  const prevStep = useCallback(function decrement() {
    setCurrentStep(function update(prev) {
      return prev > 0 ? prev - 1 : prev;
    });
  }, []);

  const resetTour = useCallback(
    function reset() {
      setCurrentStep(initialStep);
      setSteps([]);
    },
    [initialStep],
  );

  return {
    steps,
    currentStep,
    totalSteps: steps.length,
    addStep,
    nextStep,
    prevStep,
    setCurrentStep,
    resetTour,
  };
}

export function useStep({
  anchorId,
  show: controllableShow = false,
  onClose: controllableOnClose,
  nextMessage: controllableNextMessage = null,
  prevMessage: controllablePrevMessage = null,
  exitMessage: controllableExitMessage = null,
}: UseStepProps): StepState {
  const context = useContext(ProductTourContext);

  const onClose = context?.onClose ?? controllableOnClose;
  const steps = context?.steps ?? [];
  const currentStep = context?.currentStep ?? 0;
  const addStep = context?.addStep;
  const nextStep = context?.nextStep ?? function noop() {};
  const prevStep = context?.prevStep ?? function noop() {};
  const nextMessage = context?.nextMessage ?? controllableNextMessage;
  const prevMessage = context?.prevMessage ?? controllablePrevMessage;
  const exitMessage = context?.exitMessage ?? controllableExitMessage;
  const totalSteps = context?.totalSteps ?? 1;

  const checkStep = useCallback(
    function check(step: { anchorId: string }) {
      return step.anchorId === anchorId;
    },
    [anchorId],
  );

  const index = steps.findIndex(checkStep);
  const show = index === currentStep || controllableShow;

  const onTourExit = useCallback(function close() {
    onClose?.();
  }, [onClose]);

  useEffect(
    function add() {
      if (!addStep || !anchorId || steps.some(checkStep)) return;
      addStep({ anchorId });
    },
    [addStep, anchorId, checkStep, steps],
  );

  return {
    show,
    index,
    currentStep,
    totalSteps,
    nextStep: index === totalSteps - 1 ? onTourExit : nextStep,
    prevStep,
    nextMessage: index === totalSteps - 1 ? exitMessage : nextMessage,
    prevMessage: index === 0 ? null : prevMessage,
    onClose: onTourExit,
  };
}
