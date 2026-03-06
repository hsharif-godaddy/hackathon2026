'use client';

import { useMemo, useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import ChevronDownIcon from '@ux/icon/chevron-down';
import ChevronUpIcon from '@ux/icon/chevron-up';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { isPaidPlanForGrants, PAYWALL_ITC } from '@/lib/paywall/shared';
import { PAYWALL_TYPE, type PaywallType } from '@/lib/paywall/shared';
import type { CreditGrant, SubscriptionPlan } from '@/types/credits';
import { generateClickEID } from '@/utils/instrumentation';
import CreditGrantRow from './CreditGrantRow';
import RidingArrow from '../../../svgs/riding-arrow';
import SiteBuild from '../../../svgs/site-build';

interface CreditPacksCardProps {
  creditPacks: CreditGrant[];
  subscriptionPlan?: SubscriptionPlan;
  activeGrantId?: string;
  locale?: string;
  onOpenPaywall: (source: string, type?: PaywallType, itc?: string) => void;
  isGrantsEnabled: boolean;
  /** Builder entitlement ID - required for credits purchase when grants enabled */
  builderEntitlementId?: string;
}

/**
 * Credit packs card displaying purchased credit packs
 */
export default function CreditPacksCard({ creditPacks, subscriptionPlan, activeGrantId, locale, onOpenPaywall, isGrantsEnabled, builderEntitlementId }: CreditPacksCardProps) {
  const t = useTranslations();
  const [isExpanded, setIsExpanded] = useState(true);

  const { totalCreditsUsed, totalCreditsMax } = useMemo(() => ({
    totalCreditsUsed: creditPacks.reduce((sum, pack) => sum + pack.creditsSpent, 0),
    totalCreditsMax: creditPacks.reduce((sum, pack) => sum + pack.creditsMax, 0),
  }), [creditPacks]);

  const isNonPaidPlan = !isPaidPlanForGrants(subscriptionPlan, isGrantsEnabled);
  // Disable buttons when grants enabled but entitlement not yet available (async subscription)
  const isButtonDisabled = isGrantsEnabled && !builderEntitlementId;
  const hasNoPlanAndNoCredits = creditPacks.length === 0 && isNonPaidPlan;

  if (hasNoPlanAndNoCredits || creditPacks.length === 0) {
    return (
      <div className="flex flex-col md:col-span-2 bg-intents-ux-box-backgroundColor rounded-xl border border-border p-2 sm:p-4">
        <div className="flex flex-col md:flex-row items-center">
          <div className="flex-1">
            <text.strong as="title" size={0} className="block mb-2" text={t('builder_manageplan_creditpacks_empty_title')} />
            <text.p as="paragraph" className="mb-4" text={hasNoPlanAndNoCredits ? t('builder_manageplan_creditpacks_empty_plan_description') : t('builder_manageplan_creditpacks_empty_description')} />
            { hasNoPlanAndNoCredits ? (
                <Box orientation="horizontal" gap="md">
                    <Button
                      design="primary"
                      data-partial='componentAiro'
                      data-eid={generateClickEID('manageplan.buttons.upgrade')}
                      size="sm"
                      text={t('builder_manageplan_upgrade')}
                      onClick={() => onOpenPaywall('manage_plan.upgrade', 'upgrade', PAYWALL_ITC.UPGRADE)}
                      disabled={isButtonDisabled}
                    />
                    <Button
                      design="secondary"
                      data-partial='componentAiro'
                      data-eid={generateClickEID('manageplan.buttons.buy_credits')}
                      size="sm"
                      text={t('builder_manageplan_buy_credits')}
                      onClick={() => onOpenPaywall('manage_plan.buy_credits', PAYWALL_TYPE.CREDITS, PAYWALL_ITC.CREDITS)}
                      disabled={isButtonDisabled}
                    />
                </Box>
            ) : (
                <Button
                  design="secondary"
                  data-partial='componentAiro'
                  data-eid={generateClickEID('manageplan.buttons.buy_credits')}
                  size="sm"
                  text={t('builder_manageplan_buy_credits')}
                  onClick={() => onOpenPaywall('manage_plan.buy_credits', PAYWALL_TYPE.CREDITS, PAYWALL_ITC.CREDITS)}
                  disabled={isButtonDisabled}
                />
            )}
          </div>
          {hasNoPlanAndNoCredits ? <RidingArrow /> : <SiteBuild />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:col-span-2 bg-intents-ux-box-backgroundColor rounded-xl border border-border p-2 sm:p-4">
      <div className="flex items-center gap-2 w-full">
        <button
          type="button"
          className="flex-shrink-0 cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
        </button>
        <text.strong as="title" size={0} className="block" text={t('builder_manageplan_addons_title')} />
        { !isExpanded && (
          <text.p as="paragraph" size={-1} className="ml-auto">
            <span className="text-intents-ux-passive-foregroundColor">{totalCreditsUsed}</span>/{totalCreditsMax}
          </text.p>
        )}
      </div>

      {isExpanded && (
        <>
          <text.p as="paragraph" className="mt-2 mb-2 flex-shrink-0" text={t('builder_manageplan_credits_description')} />
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pr-1 max-h-40">
            {creditPacks.map(function renderGrant(grant) {
              return (
                <CreditGrantRow
                  key={grant.id}
                  grant={grant}
                  isActive={activeGrantId === grant.id}
                  locale={locale}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
