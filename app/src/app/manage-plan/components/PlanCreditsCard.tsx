import { useState } from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import ChevronDownIcon from '@ux/icon/chevron-down';
import ChevronUpIcon from '@ux/icon/chevron-up';
import Tag from '@ux/tag';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import type { AiroSubscription } from '@/lib/mgmt-airo';
import { isPaidPlanForGrants, PAYWALL_ITC, PAYWALL_TYPE, type PaywallType } from '@/lib/paywall/shared';
import type { CreditGrant } from '@/types/credits';
import { SubscriptionPlan } from '@/types/credits';
import { formatFullCreditDate, getEffectiveCreditsSpent, getPlanDisplayLabelKey, getPlanFromSubscription } from '@/utils/credits';
import { generateClickEID } from '@/utils/instrumentation';
import ActiveTag from './ActiveTag';
import CreditProgressBar from './CreditProgressBar';

interface PlanCreditsCardProps {
  subscription: AiroSubscription;
  planGrant: CreditGrant;
  activeGrantId?: string;
  locale?: string;
  creditPacks: CreditGrant[];
  openPaywall: (source: string, type: PaywallType, itc?: string) => void;
  autoRenewStatus?: { autoRenew: boolean; paidThroughDate?: string; subscriptionId?: string } | null;
  onDowngradeClick?: () => void;
  isGrantsEnabled: boolean;
  isHigherPlansEnabled?: boolean;
}

const PlanCreditsCard = ({ subscription, planGrant, activeGrantId, locale, creditPacks, openPaywall, autoRenewStatus, onDowngradeClick, isGrantsEnabled, isHigherPlansEnabled = false }: PlanCreditsCardProps) => {
  const t = useTranslations();
  const [isExpanded, setIsExpanded] = useState(true);

  if (!planGrant || !subscription) {
    return null;
  }

  const currentPlan = getPlanFromSubscription(subscription);
  // Disable buttons when grants enabled but entitlement not yet available (async subscription)
  const isButtonDisabled = isGrantsEnabled && !subscription.builderEntitlementId;
  const planLabelKey = getPlanDisplayLabelKey(currentPlan);
  const planDisplayLabel = planLabelKey ? t(planLabelKey) : '';
  const isPaidPlan = isPaidPlanForGrants(currentPlan, isGrantsEnabled);
  const isFreePlan = !isPaidPlan;
  const hasCreditsNoPlan = creditPacks.length > 0 && isFreePlan;
  const isActive = activeGrantId === planGrant.id;

  // Calculate reset date from monthly grant useBefore or subscription renewsAt
  const resetDate = planGrant
  ? formatFullCreditDate(planGrant.useBefore, locale)
  : subscription.renewsAt
    ? formatFullCreditDate(subscription.renewsAt, locale)
    : null;

  // Calculate reset time from monthly grant created time
  const resetTime = planGrant
    ? new Date(planGrant.createdAt).toLocaleTimeString(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : null;

  return (
    <div className="flex flex-col md:col-span-2 bg-intents-ux-box-backgroundColor rounded-xl border border-border gap-2 p-2 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex-shrink-0 cursor-pointer"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
          </button>
          <text.strong as="title" size={0} className="block flex-shrink-0" text={t('builder_manageplan_plan_title')} />
          {isActive && <ActiveTag tooltipText={t('builder_manageplan_using_monthly')} />}
        </div>
        {/* Row 2 on mobile, same row on desktop: Plan tag */}
        <div className="flex items-center gap-2 sm:ml-auto">
          {isFreePlan ? (
            <Tag emphasis="passive">
              {planDisplayLabel}
            </Tag>
          ) : planDisplayLabel ? (
            <Tag className="!bg-ai-light !text-intents-ux-boxHighContrast-foregroundColor">
              {planDisplayLabel}
            </Tag>
          ) : null}
        </div>
      </div>

      {isExpanded && (
        <>
          {resetDate && resetTime && (
            <text.p as="paragraph">
              {t('builder_manageplan_reset_info', {
                date: resetDate,
                time: resetTime,
              })}
            </text.p>
          )}
          {hasCreditsNoPlan && (
            <text.p as="label" text={t('builder_manageplan_creditpacks_empty_plan_description')} />
          )}
          <CreditProgressBar spent={getEffectiveCreditsSpent(planGrant.creditsSpent, planGrant.creditsMax)} max={planGrant.creditsMax} />
          {(creditPacks.length > 0 || (!isFreePlan && creditPacks.length === 0)) && currentPlan && (
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
              <Box orientation="horizontal" gap="md">
                {isFreePlan && !isHigherPlansEnabled && creditPacks.length > 0 && (
                  <Button
                    design="primary"
                    data-partial='componentAiro'
                    data-eid={generateClickEID('manageplan.buttons.upgrade')}
                    size="sm"
                    text={t('builder_manageplan_upgrade')}
                    onClick={() => openPaywall('manage_plan.upgrade', PAYWALL_TYPE.UPGRADE, PAYWALL_ITC.UPGRADE)}
                    disabled={isButtonDisabled}
                  />
                )}
                {isHigherPlansEnabled && (
                    <Button
                        design="primary"
                        data-partial='componentAiro'
                        data-eid={generateClickEID('manageplan.buttons.upgrade_plan')}
                        size="sm"
                        text={currentPlan === SubscriptionPlan.Ultimate && !subscription.downgradedPlan ? t('builder_manageplan_downgrade') : t('builder_manageplan_upgrade')}
                        onClick={() => openPaywall('manage_plan.upgrade_plan', PAYWALL_TYPE.UPGRADE, PAYWALL_ITC.UPGRADE)}
                        disabled={isButtonDisabled}
                    />
                )}
                { creditPacks.length > 0 && (
                    <Button
                        design="secondary"
                        data-partial='componentAiro'
                        data-eid={generateClickEID('manageplan.buttons.buy_credits')}
                        size="sm"
                        text={t('builder_manageplan_buy_credits')}
                        onClick={() => openPaywall('manage_plan.buy_credits', PAYWALL_TYPE.CREDITS, PAYWALL_ITC.CREDITS)}
                        disabled={isButtonDisabled}
                    />
                )}
              </Box>
              {isPaidPlan && autoRenewStatus?.autoRenew === true && onDowngradeClick && (
                <Button
                  className="items-center"
                  design="inline"
                  data-partial='componentAiro'
                  data-eid={generateClickEID('manageplan.buttons.downgrade_plan')}
                  size="sm"
                  text={t('builder_manageplan_downgrade_plan')}
                  onClick={onDowngradeClick}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PlanCreditsCard;