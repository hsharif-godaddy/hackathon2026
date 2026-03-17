import { useState } from 'react';
import { CircleStackIcon, CloudArrowUpIcon } from '@heroicons/react/24/outline';
import Box from '@ux/box';
import Button from '@ux/button';
import ChevronDownIcon from '@ux/icon/chevron-down';
import ChevronUpIcon from '@ux/icon/chevron-up';
import Tag from '@ux/tag';
import text from '@ux/text';

import { InfoTooltip } from '@/components/ui/InfoTooltip';
import { useTranslations } from '@/hooks/useTranslations';
import type { AiroSubscription } from '@/lib/mgmt-airo';
import { isPaidPlanForGrants, PAYWALL_ITC, PAYWALL_TYPE, type PaywallType } from '@/lib/paywall/shared';
import { getPublishLimit } from '@/lib/publish-limit';
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
  const publishLimit = getPublishLimit(currentPlan);
  // Disable buttons when grants enabled but entitlement not yet available (async subscription)
  const isButtonDisabled = isGrantsEnabled && !subscription.builderEntitlementId;
  const planLabelKey = getPlanDisplayLabelKey(currentPlan);
  const planDisplayLabel = planLabelKey ? t(planLabelKey) : '';
  const isPaidPlan = isPaidPlanForGrants(currentPlan, isGrantsEnabled);
  const isFreePlan = !isPaidPlan;
  const hasCreditsNoPlan = creditPacks.length > 0 && isFreePlan;
  const isActive = activeGrantId === planGrant.id;

  // Calculate reset date from monthly grant useBefore (with validation)
  const useBeforeDate = planGrant.useBefore ? new Date(planGrant.useBefore) : null;
  const isValidUseBeforeDate = useBeforeDate && !isNaN(useBeforeDate.getTime());
  const resetDate = isValidUseBeforeDate ? formatFullCreditDate(planGrant.useBefore, locale) : null;

  // Calculate reset time from monthly grant created time (with validation)
  const createdAtDate = planGrant.createdAt ? new Date(planGrant.createdAt) : null;
  const isValidCreatedAtDate = createdAtDate && !isNaN(createdAtDate.getTime());
  const resetTime = isValidCreatedAtDate
    ? createdAtDate.toLocaleTimeString(locale, {
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
            aria-label={isExpanded ? t('builder_common_collapse') : t('builder_common_expand')}
          >
            {isExpanded ? <ChevronUpIcon className="w-4 h-4" /> : <ChevronDownIcon className="w-4 h-4" />}
          </button>
          <text.strong as="title" size={0} className="block flex-shrink-0" text={t('builder_manageplan_plan_title')} />
          {isActive && <span className="hidden sm:inline"><ActiveTag tooltipText={t('builder_manageplan_using_monthly')} /></span>}
        </div>
        {/* Row 2 on mobile, same row on desktop: Plan tag */}
        <div className="flex justify-between md:justify-end md:items-center sm:flex-1 gap-2 sm:ml-auto">
          {isActive && <span className="sm:hidden"><ActiveTag tooltipText={t('builder_manageplan_using_monthly')} /></span>}
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
          <div className="flex flex-col gap-1">
            <text.strong as="label" text={t('builder_manageplan_plan_features')} />
            <div className="flex items-center gap-1">
              <CircleStackIcon className="w-2.5 h-2.5 text-intents-ux-passive-foregroundColor flex-shrink-0" />
              <div className="flex items-center gap-0.5">
                <text.p as="paragraph" size={-1}>
                  {t('builder_manageplan_plan_credits_per_month', { count: planGrant.creditsMax })}
                </text.p>
                <InfoTooltip content={t('builder_manageplan_plan_credits_tooltip')} />
              </div>
            </div>
            {publishLimit !== null && publishLimit > 0 && (
              <div className="flex items-center gap-1">
                <CloudArrowUpIcon className="w-2.5 h-2.5 text-intents-ux-passive-foregroundColor flex-shrink-0" />
                <text.p as="paragraph" size={-1}>
                  {t('builder_manageplan_plan_publish_limit', { count: publishLimit })}
                </text.p>
              </div>
            )}
          </div>

          {/* Plan Usage Section */}
          <div className="flex flex-col gap-1 mt-2">
            <text.strong as="label" text={t('builder_manageplan_plan_usage')} />
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
          </div>
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