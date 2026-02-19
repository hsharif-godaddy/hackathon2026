'use client';

import Box from '@ux/box';
import FacebookIcon from '@ux/icon/facebook';
import InstagramIcon from '@ux/icon/instagram';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { cn } from '@/lib/utils';

interface PlatformSelectorProps {
  selectedPlatforms: Set<'facebook' | 'instagram'>;
  onChange: (platforms: Set<'facebook' | 'instagram'>) => void;
}

export default function PlatformSelector({
  selectedPlatforms,
  onChange
}: PlatformSelectorProps) {
  const t = useTranslations();

  const handlePlatformToggle = (platform: 'facebook' | 'instagram', checked: boolean) => {
    const newPlatforms = new Set(selectedPlatforms);
    if (checked) {
      newPlatforms.add(platform);
    } else {
      newPlatforms.delete(platform);
    }
    onChange(newPlatforms);
  };

  return (
    <Box gap="sm">
      <label className="text-sm font-medium text-intents-ux-textStandard-textColor">
        {t('builder_marketing_select_platforms')}
      </label>
      <label
        className={cn(
          'flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-all',
          selectedPlatforms.has('facebook')
            ? 'border-intents-ux-actionPrimary-borderColor bg-intents-ux-actionPrimary-backgroundColor/10'
            : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxStandard-backgroundColor hover:border-intents-ux-actionPrimary-borderColor/50'
        )}
      >
        <input
          type="checkbox"
          checked={selectedPlatforms.has('facebook')}
          onChange={(e) => handlePlatformToggle('facebook', e.target.checked)}
          className="w-4 h-4 rounded border-intents-ux-boxLowContrast-borderColor"
        />
        <FacebookIcon className="w-4 h-4 text-intents-ux-actionPrimary-textColor" />
        <span className="text-sm font-medium text-intents-ux-textStandard-textColor">
          {t('builder_marketing_facebook')}
        </span>
      </label>

      <label
        className={cn(
          'flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-all',
          selectedPlatforms.has('instagram')
            ? 'border-intents-ux-actionPrimary-borderColor bg-intents-ux-actionPrimary-backgroundColor/10'
            : 'border-intents-ux-boxLowContrast-borderColor bg-intents-ux-boxStandard-backgroundColor hover:border-intents-ux-actionPrimary-borderColor/50'
        )}
      >
        <input
          type="checkbox"
          checked={selectedPlatforms.has('instagram')}
          onChange={(e) => handlePlatformToggle('instagram', e.target.checked)}
          className="w-4 h-4 rounded border-intents-ux-boxLowContrast-borderColor"
        />
        <InstagramIcon className="w-4 h-4 text-intents-ux-actionPrimary-textColor" />
        <span className="text-sm font-medium text-intents-ux-textStandard-textColor">
          {t('builder_marketing_instagram')}
        </span>
      </label>
      {selectedPlatforms.size === 0 && (
        <text.p className="text-xs text-intents-ux-feedbackError-textColor">
          {t('builder_marketing_select_at_least_one_platform')}
        </text.p>
      )}
    </Box>
  );
}
