'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';
import TimePicker from '@ux/time-picker';

import { useTranslations } from '@/hooks/useTranslations';
import { CalendarEvent } from '@/types/marketing';
import { getUserLocale } from '@/utils/common';
import PlatformSelector from './PlatformSelector';

interface SocialInstructionsFormProps {
  selectedEvent: CalendarEvent | null;
  selectedPlatforms: Set<'facebook' | 'instagram'>;
  onSelectedPlatformsChange: (platforms: Set<'facebook' | 'instagram'>) => void;
  scheduledTime: string;
  onScheduledTimeChange: (time: string) => void;
  customInstructions: string;
  onCustomInstructionsChange: (instructions: string) => void;
  userTimezone: string;
  timeValidation: { isValid: boolean; message: string | null };
  shouldDisableTime: (timeString: string) => boolean;
  onBack: () => void;
  onSubmit: () => void;
}

export default function SocialInstructionsForm({
  selectedEvent,
  selectedPlatforms,
  onSelectedPlatformsChange,
  scheduledTime,
  onScheduledTimeChange,
  customInstructions,
  onCustomInstructionsChange,
  userTimezone,
  timeValidation,
  shouldDisableTime,
  onBack,
  onSubmit
}: SocialInstructionsFormProps) {
  const t = useTranslations();

  return (
    <Box gap="md">
      {/* Event header (if event selected) */}
      {selectedEvent && (
        <Box gap="sm" className="pb-3 border-b border-intents-ux-boxLowContrast-borderColor">
          <text.h4 size={1} className="font-semibold">
            {selectedEvent.name}
          </text.h4>
          {selectedEvent.description && (
            <text.p className="text-sm text-intents-ux-textSubdued-textColor">
              {selectedEvent.description}
            </text.p>
          )}
        </Box>
      )}

      {!selectedEvent && (
        <Box className="pb-3 border-b border-intents-ux-boxLowContrast-borderColor">
          <text.h4 size={1} className="font-semibold">
            {t('builder_marketing_custom_social_post')}
          </text.h4>
        </Box>
      )}

      {/* Platform Selection */}
      <PlatformSelector
        selectedPlatforms={selectedPlatforms}
        onChange={onSelectedPlatformsChange}
      />

      {/* Time picker */}
      <Box gap="sm">
        <TimePicker
          id="social-schedule-time"
          label={t('builder_marketing_publish_time')}
          value={scheduledTime}
          onChange={onScheduledTimeChange}
          visualSize="md"
          required
          hour12={true}
          minuteInterval={15}
          locale={getUserLocale()}
          shouldDisableTime={shouldDisableTime}
        />
        <div className="flex items-center gap-1">
          <span className="text-xs px-2 py-0.5 rounded bg-intents-ux-actionPrimary-backgroundColor/10 text-intents-ux-actionPrimary-textColor">
            {t('builder_social_schedule_timezone', { timezone: userTimezone })}
          </span>
        </div>
        {!timeValidation.isValid && timeValidation.message && (
          <text.p className="text-xs text-intents-ux-feedbackError-textColor">
            {t(timeValidation.message)}
          </text.p>
        )}
      </Box>

      {/* Instructions */}
      <Box gap="sm">
        <label htmlFor="social-instructions" className="text-sm font-medium text-intents-ux-textStandard-textColor">
          {t('builder_marketing_additional_instructions')} <span className="text-intents-ux-textSubdued-textColor font-normal">{t('builder_marketing_optional')}</span>
        </label>
        <textarea
          id="social-instructions"
          value={customInstructions}
          onChange={(e) => onCustomInstructionsChange(e.target.value)}
          placeholder={t('builder_marketing_social_instructions_placeholder')}
          rows={4}
          className="w-full p-3 border border-intents-ux-boxLowContrast-borderColor rounded-lg resize-none
            text-intents-ux-textStandard-textColor placeholder:text-intents-ux-textSubdued-textColor
            focus:outline-none focus:ring-2 focus:ring-intents-ux-actionPrimary-backgroundColor focus:border-transparent
            transition-shadow"
        />
      </Box>

      {/* Action buttons */}
      <Box orientation="horizontal" gap="sm" inlineAlignChildren="end" className="pt-2">
        <Button
          onClick={onBack}
          design="secondary"
          size="md"
        >
          {t('builder_marketing_back')}
        </Button>
        <Button
          onClick={onSubmit}
          disabled={selectedPlatforms.size === 0 || !timeValidation.isValid}
          design="primary"
          size="md"
        >
          {t('builder_marketing_schedule_social_post')}
        </Button>
      </Box>
    </Box>
  );
}
