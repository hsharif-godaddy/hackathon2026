import clsx from 'clsx';
import Box from '@ux/box';
import Spinner from '@ux/spinner';
import TextLockup from '@ux/text-lockup';

import { useTranslations } from '@/hooks/useTranslations';

/**
 * Loading state component for settings panels
 * Displays a centered spinner with customizable title and description
 */
interface SettingsLoadingStateProps {
  /** Loading title text. Defaults to 'Loading...' translation */
  title?: string;
  /** Optional description text shown below the title */
  description?: string;
  /** Optional className applied to the outer Box */
  className?: string;
  /** When true, applies full-page centered styling with low-contrast background */
  fullPage?: boolean;
}

/**
 * Renders a loading state with spinner and text for settings panels
 */
export function SettingsLoadingState({ title, description, className, fullPage }: SettingsLoadingStateProps) {
  const t = useTranslations();

  return (
    <Box
      blockAlignChildren='center'
      inlineAlignChildren='center'
      gap='md'
      className={clsx(className, fullPage && 'h-full intents-ux-boxLowContrast border-0 rounded-lg')}
    >
      <Spinner size='md'/>
      <TextLockup
        title={title ?? t('builder_common_loading')}
        centered
      >
        {description && (
          <div className='text-intents-ux-feedbackHighContrastPassive-feedbackColor'>
            {description}
          </div>
        )}
      </TextLockup>
    </Box>
  );
}
