'use client';

import Box from '@ux/box';
import Chip from '@ux/chip';
import FacebookIcon from '@ux/icon/facebook';
import InstagramIcon from '@ux/icon/instagram';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';

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
      <text.label as="label" size={-1}>
        {t('builder_marketing_select_platforms')}
      </text.label>
      <Box orientation='horizontal' gap="sm">
        <Chip
          label={t('builder_marketing_facebook')}
          icon={<FacebookIcon />}
          selected={selectedPlatforms.has('facebook')}
          onSelect={() => handlePlatformToggle('facebook', !selectedPlatforms.has('facebook'))}
        />

        <Chip
          label={t('builder_marketing_instagram')}
          icon={<InstagramIcon />}
          selected={selectedPlatforms.has('instagram')}
          onSelect={() => handlePlatformToggle('instagram', !selectedPlatforms.has('instagram'))}
        />
      </Box>
      {selectedPlatforms.size === 0 && (
        <text.p as="caption" emphasis='critical'>
          {t('builder_marketing_select_at_least_one_platform')}
        </text.p>
      )}
    </Box>
  );
}
