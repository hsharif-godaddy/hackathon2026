'use client';

import clsx from 'clsx';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import Button from '@ux/button';
import CheckIcon from '@ux/icon/checkmark';
import DiamondIcon from '@ux/icon/diamond';
import text from '@ux/text';

import { useBreakpoints } from '@/hooks/useBreakpoints';
import { usePaywallEligibility } from '@/hooks/usePaywallEligibility';
import { useSubscription } from '@/hooks/useSubscription';
import { useSwitchboard } from '@/hooks/useSwitchboard';
import { useTranslations } from '@/hooks/useTranslations';
import { isBuilderPagePath } from '@/lib/builder-route';
import { shipAnalyticsLog } from '@/lib/logging';
import { canUpgradePlan, isPaidPlanForGrants, PAYWALL_ITC } from '@/lib/paywall/shared';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { usePaywallStore } from '@/stores/usePaywallStore';
import { getPlanFromSubscription } from '@/utils/credits';
import { logClickEvent } from '@/utils/instrumentation';

interface HeaderUpgradeButtonProps {
  location?: string;
}

export default function HeaderUpgradeButton({ location = 'unknown' }: HeaderUpgradeButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { isBelowSmBreakpoint } = useBreakpoints();
  const pathname = usePathname();
  const isDevelopPage = isBuilderPagePath(pathname);
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal);

  const featureEnabled = useSwitchboard('appbuilder-airoplus-upgrade-button');
  const { showPaywall, isLoading: isPaywallLoading } = usePaywallEligibility();
  const { data: subscription } = useSubscription();
  const currentPlan = subscription ? getPlanFromSubscription(subscription) : undefined;
  const clickContext = useMemo(
    () => (currentAppId ? { appId: currentAppId } : undefined),
    [currentAppId],
  );

  // Only show on develop page, when feature enabled, and user can upgrade (non-Ultimate users)
  if (!isDevelopPage || isPaywallLoading || !featureEnabled ||
      (!showPaywall && !canUpgradePlan(currentPlan))) return null;

  const handleUpgradeClick = () => {
    logClickEvent(`${location}.header.upgrade_popover`, clickContext)();
    openUpgradeModal('header.upgrade_button', PAYWALL_ITC.UPGRADE);
    setOpen(false);
    shipAnalyticsLog('header.upgrade_button.clicked', {
      appId: currentAppId,
      location,
    });
  };

  const isOnPaidPlan = isPaidPlanForGrants(currentPlan);

  const benefits = isOnPaidPlan
    ? [
        t('builder_upgrade_benefit_code'),
        t('builder_upgrade_paid_plan_benefit_apps'),
        t('builder_upgrade_paid_plan_benefit_credits'),
      ]
    : [
        t('builder_upgrade_benefit_code'),
        t('builder_upgrade_benefit_credits'),
        t('builder_upgrade_benefit_publish'),
      ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          design='tertiary'
          size='sm'
          data-partial='componentAiro'
          icon={<DiamondIcon className="!size-2.5" />}
          text={t('builder_upgrade_button')}
          aria-label={isBelowSmBreakpoint ? t('builder_upgrade_button') : undefined}
          className={clsx(
            "!rounded-lg !pt-0 !pb-0 !pl-0.5 !pr-0.5 md:!px-1 md:!py-[6px]",
            isDevelopPage ? '!rounded-xmd md:!py-[8px]' : '!rounded-lg md:!py-[6px]'
          )}
          onClick={() => {
            logClickEvent(`${location}.header.upgrade`, clickContext)();
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        align='end'
        className={clsx(
          'p-3',
          isOnPaidPlan ? 'w-[375px]' : 'w-[300px]'
        )}
      >
        <div className='flex flex-col'>
          <text.h4 as='title' className='mb-1'>
            { isOnPaidPlan
              ? t('builder_upgrade_paid_plan_title')
              : t('builder_upgrade_plans_popover_title')
            }
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
            onClick={handleUpgradeClick}
            text={t('builder_upgrade_plans_popover_cta')}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
