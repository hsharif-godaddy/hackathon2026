import type { FeedbackProps } from '@/components/feedback/types';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { FeedbackMultiStep } from './FeedbackMultiStep';

export function Feedback(props: FeedbackProps) {
  const isMultiStepEnabled = useSwitchboard('airo-builder-feedback-multistep');
  if (!isMultiStepEnabled) return null;
  return <FeedbackMultiStep {...props} />;
}
