'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import Button from '@ux/button';
import CheckIcon from '@ux/icon/checkmark';
import XIcon from '@ux/icon/x';
import text from '@ux/text';

import { useBreakpoints } from '@/hooks/useBreakpoints';
import { useTranslations } from '@/hooks/useTranslations';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { usePaywallStore } from '@/stores/usePaywallStore';
import { logClickEvent, logImpressionEvent } from '@/utils/instrumentation';

interface PublishUpsellPopoverProps {
  appId?: string;
  triggerLabel: string;
  triggerClassName?: string;
  onPublishClick?: () => void;
}

/**
 * Treatment UI for the aab_combine_upgrade_with_publish experiment. Replaces the normal publish
 * popover for eligible free `on`-cohort users with an educational upsell; "See Plans" opens the
 * existing UPP modal via the global <UpgradeModal> (usePaywallStore.openUpgradeModal).
 */
export default function PublishUpsellPopover({
  appId,
  triggerLabel,
  triggerClassName,
  onPublishClick,
}: PublishUpsellPopoverProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { isBelowSmBreakpoint } = useBreakpoints();
  const openUpgradeModal = usePaywallStore((state) => state.openUpgradeModal);
  const armPublishOpenAfterUpgrade = usePaywallStore((state) => state.armPublishOpenAfterUpgrade);
  const clickContext = useMemo(() => (appId ? { appId } : undefined), [appId]);

  const benefits = [
    t('builder_publish_upsell_benefit_live_link'),
    t('builder_publish_upsell_benefit_custom_domain'),
    t('builder_publish_upsell_benefit_credits'),
  ];

  // Radix only calls onOpenChange for Radix-initiated changes (trigger click, outside-click,
  // Escape). Programmatic setOpen(false) from X / See Plans does NOT invoke it, so those paths
  // never emit dismiss_outside — no guard/ref needed.
  const handleOpenChange = (next: boolean): void => {
    if (next) {
      onPublishClick?.();
      logClickEvent('develop.publish_upsell.publish_click', clickContext)();
      logImpressionEvent('develop.publish_upsell.view', clickContext)();
      setOpen(true);
      return;
    }
    logClickEvent('develop.publish_upsell.dismiss_outside', clickContext)();
    setOpen(false);
  };

  const handleSeePlans = (): void => {
    logClickEvent('develop.publish_upsell.see_plans', clickContext)();
    setOpen(false);
    // Arm the post-upgrade auto-open so the publish popover opens once the account flips to paid.
    if (appId) {
      armPublishOpenAfterUpgrade(appId);
    }
    openUpgradeModal('publish_upsell.see_plans', PAYWALL_ITC.PUBLISH);
  };

  const handleClose = (): void => {
    logClickEvent('develop.publish_upsell.dismiss_x', clickContext)();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id="tour-publish-button"
          design="primary"
          size="sm"
          data-partial="componentAiro"
          data-testid="publish-upsell-trigger"
          text={triggerLabel}
          aria-label={triggerLabel}
          className={triggerClassName}
        />
      </PopoverTrigger>
      <PopoverContent
        align={isBelowSmBreakpoint ? 'center' : 'end'}
        className={clsx('p-[20px]', isBelowSmBreakpoint ? 'w-[calc(100vw-2rem)]' : 'w-[340px]')}
      >
        <div className="relative flex flex-col">
          <button
            type="button"
            data-testid="publish-upsell-close"
            aria-label={t('builder_common_close', undefined, 'Close')}
            className="absolute top-0 right-0 text-intents-ux-boxLowContrast-foregroundColor hover:cursor-pointer"
            onClick={handleClose}
          >
            <XIcon className="!size-2.5" />
          </button>
          <text.h4 as="title" className="mb-1 whitespace-nowrap ux-text-size-2">
            {t('builder_publish_upsell_title')}
          </text.h4>
          <ul className="flex flex-col gap-1 mb-3">
            {benefits.map((benefit) => (
              <li key={benefit} className="flex items-center gap-1">
                <CheckIcon className="w-3 h-3 text-[#7c3aed] flex-shrink-0" />
                <text.p size={-1}>{benefit}</text.p>
              </li>
            ))}
          </ul>
          <Button
            design="primary"
            size="sm"
            className="w-full"
            data-partial="componentAiro"
            data-testid="publish-upsell-see-plans"
            onClick={handleSeePlans}
            text={t('builder_publish_upsell_cta')}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
