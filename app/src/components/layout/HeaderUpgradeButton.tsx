'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';
import Button from '@ux/button';
import CheckIcon from '@ux/icon/checkmark';
import DiamondIcon from '@ux/icon/diamond';
import text from '@ux/text';

import { useBreakpoints } from '@/hooks/useBreakpoints';
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { shipAnalyticsLog } from '@/lib/logging';
import { canUpgradePlan, PAYWALL_ITC } from '@/lib/paywall/shared';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { getPlanFromSubscription } from '@/utils/credits';
import { generateClickEID } from '@/utils/instrumentation';

interface HeaderUpgradeButtonProps {
  location?: string;
}

export default function HeaderUpgradeButton({ location = 'unknown' }: HeaderUpgradeButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { isBelowSmBreakpoint } = useBreakpoints();
  const pathname = usePathname();
  const isDevelopPage = pathname?.includes('/develop/');
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const openUpgradeModal = useDevelopPageStore((state) => state.openUpgradeModal);

  const { data: featureEnabled, isLoading: isFeatureLoading } = useSwitchboard('appbuilder-airoplus-upgrade-button');
  const { data: isGrantsEnabled } = useSwitchboard('app-builder-grants');
  const { data: isHigherPlansEnabled } = useSwitchboard('appbuilder-higher-plans');
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility(currentAppId || undefined);
  const { data: subscription } = useSubscription();
  const currentPlan = subscription ? getPlanFromSubscription(subscription) : undefined;

  // Only show on develop page, when feature enabled, and user doesn't have paid plan
  // With higher plans enabled, also show for non-Ultimate paid users
  if (!isDevelopPage || isFeatureLoading || isPaywallLoading || !featureEnabled ||
      (!showPaywall && !canUpgradePlan(currentPlan, !!isHigherPlansEnabled))) return null;

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
      <PopoverTrigger asChild>
        <Button
          design='tertiary'
          size='sm'
          data-partial='componentAiro'
          data-eid={generateClickEID('develop.header.upgrade')}
          icon={<DiamondIcon className="!size-2.5" />}
          text={t('builder_upgrade_button')}
          aria-label={isBelowSmBreakpoint ? t('builder_upgrade_button') : undefined}
          className="!rounded-lg !leading-none !pt-0 !pb-0 !pl-0.5 !pr-0.5 md:!px-1 md:!py-[6px]"
        />
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
