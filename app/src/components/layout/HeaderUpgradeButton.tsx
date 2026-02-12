'use client';

import clsx from 'clsx';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import Button from '@ux/button';
import CheckIcon from '@ux/icon/checkmark';
import DiamondIcon from '@ux/icon/diamond';
import text from '@ux/text';

import { usePaywallEligibility } from '@/hooks/usePaywallEligibility';
import { useResponsive } from '@/hooks/useResponsive';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
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
  const pathname = usePathname();
  const isDevelopPage = pathname?.includes('/develop/');
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal);

  const { data: featureEnabled, isLoading: isFeatureLoading } = useSwitchboard('appbuilder-airoplus-upgrade-button');
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants');
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(currentAppId || undefined);

  // Only show on develop page, when feature enabled, and user doesn't have paid plan
  if (!isDevelopPage || isFeatureLoading || isPaywallLoading || !featureEnabled || !showPaywall) return null;

  const handleUpgradeClick = () => {
    setOpen(false);
    openUpgradeModal('header.upgrade_button', PAYWALL_ITC.UPGRADE);
    shipAnalyticsLog('header.upgrade_button.clicked', {
      appId: currentAppId,
      location,
    });
  };

  // When grants feature is enabled, use new paid-plan benefit text
  const benefits = [
    t('builder_upgrade_benefit_code'),
    isGrantsEnabled ? t('builder_upgrade_benefit_credits') : t('builder_upgrade_benefit_payments'),
    t('builder_upgrade_benefit_publish'),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={clsx(
          'inline-flex items-center gap-1 text-sm font-medium rounded-md px-1 sm:px-2 text-intents-ux-boxHighContrast-foregroundColor active:bg-ai-light transition-all hover:cursor-pointer',
          isMobile ? 'h-[39.33px]' : 'h-[37.56px]', // since we need a custom button matching the height of uxcore buttons
          open ? 'bg-ai-light hover:bg-ring-ai' : 'hover:bg-ai-dark-transparent'
        )}
        data-eid={generateClickEID(`${location}.header.upgrade`)}
        aria-label={isMobile ? t('builder_upgrade_button') : undefined}
      >
        <DiamondIcon className='size-2.5' />
        {!isMobile && t('builder_upgrade_button')}
      </PopoverTrigger>
      <PopoverContent
        align='end'
        className='w-[300px] p-3'
      >
        <div className='flex flex-col'>
          <text.h4 as='title' className='mb-1'>
            { isGrantsEnabled ?  t('builder_upgrade_plans_popover_title') : t('builder_upgrade_popover_title') }
          </text.h4>
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
            text={isGrantsEnabled ? t('builder_upgrade_plans_popover_cta') : t('builder_upgrade_popover_cta')}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
