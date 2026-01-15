'use client';

import { useState } from 'react';
import Button from '@ux/button';
import CheckIcon from '@ux/icon/checkmark';
import SparkleIcon from '@ux/icon/sparkles';
import text from '@ux/text';

import { usePaywallEligibility } from '@/hooks/usePaywallEligibility';
import { useResponsive } from '@/hooks/useResponsive';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { generateClickEID } from '@/utils/instrumentation';

interface HeaderUpgradeButtonProps {
  location?: string;
}

export default function HeaderUpgradeButton({ location = 'unknown' }: HeaderUpgradeButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { isMobile } = useResponsive();
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal);

  const { data: featureEnabled, isLoading: isFeatureLoading } = useSwitchboard('appbuilder-airoplus-upgrade-button');
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(currentAppId || undefined);

  // Don't show if feature flag is loading, disabled, or user already has Airo Plus
  if (isFeatureLoading || isPaywallLoading || !featureEnabled || !showPaywall) return null;

  const handleUpgradeClick = () => {
    setOpen(false);
    openUpgradeModal('header.upgrade_button');
    shipAnalyticsLog('header.upgrade_button.clicked', {
      appId: currentAppId,
      location,
    });
  };

  const benefits = [
    t('builder_upgrade_benefit_code'),
    t('builder_upgrade_benefit_payments'),
    t('builder_upgrade_benefit_publish'),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          design='secondary'
          size='sm'
          data-partial='componentAiro'
          data-eid={generateClickEID(`${location}.header.upgrade`)}
          icon={<SparkleIcon />}
          text={isMobile ? undefined : t('builder_upgrade_button')}
        />
      </PopoverTrigger>
      <PopoverContent
        align='end'
        className='w-[300px] p-3'
      >
        <div className='flex flex-col'>
          <text.h4 as='title' className='mb-2'>
            {t('builder_upgrade_popover_title')}
          </text.h4>

          <text.p size={-1} className='text-intents-ux-boxLowContrast-foregroundColor'>
            {t('builder_upgrade_popover_subtitle')}
          </text.p>

          <ul className='flex flex-col gap-1 mb-3'>
            {benefits.map((benefit, index) => (
              <li key={index} className='flex items-center gap-1'>
                <CheckIcon className='w-3 h-3 text-intents-ux-feedbackHighContrastSuccess-feedbackColor flex-shrink-0' />
                <text.p size={-1}>{benefit}</text.p>
              </li>
            ))}
          </ul>

          <Button
            design='primary'
            size='sm'
            className='w-full'
            data-partial='componentAiro'
            data-eid={generateClickEID(`${location}.header.upgrade_popover`)}
            onClick={handleUpgradeClick}
            text={t('builder_upgrade_popover_cta')}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
