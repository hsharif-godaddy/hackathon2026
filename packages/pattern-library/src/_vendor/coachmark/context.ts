import { createContext, type ReactNode } from 'react';

export interface TourStep {
  anchorId: string;
}

export interface TourState {
  steps: TourStep[];
  currentStep: number;
  totalSteps: number;
  addStep: (step: TourStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  setCurrentStep: (step: number) => void;
  resetTour: () => void;
}

export interface ProductTourContextValue extends TourState {
  onClose?: () => void;
  nextMessage: ReactNode;
  prevMessage: ReactNode;
  exitMessage: ReactNode;
}

const ProductTourContext = createContext<ProductTourContextValue | null>(null);

export default ProductTourContext;
