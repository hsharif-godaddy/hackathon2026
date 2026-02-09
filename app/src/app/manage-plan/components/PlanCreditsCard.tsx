import clsx from 'clsx';
import Box from '@ux/box';
import Button from '@ux/button';
import Tag from '@ux/tag';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import type { AiroSubscription } from '@/lib/mgmt-airo';
import { PAYWALL_ITC } from '@/lib/paywall/shared';
import { type CreditGrant, PAID_PLANS, SubscriptionPlan } from '@/types/credits';
import { formatFullCreditDate, getPlanDisplayLabelKey, getPlanFromSubscription } from '@/utils/credits';
import { generateClickEID } from '@/utils/instrumentation';
import ActiveTag from './ActiveTag';
import CreditProgressBar from './CreditProgressBar';
import type { PaywallType } from './types';

interface PlanCreditsCardProps {
  subscription: AiroSubscription;
  planGrant: CreditGrant;
  activeGrantId?: string;
  locale?: string;
  creditPacks: CreditGrant[];
  openPaywall: (source: string, type: PaywallType, itc?: string) => void;
  autoRenewStatus?: { autoRenew: boolean; paidThroughDate?: string; subscriptionId?: string } | null;
  onDowngradeClick?: () => void;
}

const PlanCreditsCard = ({ subscription, planGrant, activeGrantId, locale, creditPacks, openPaywall, autoRenewStatus, onDowngradeClick }: PlanCreditsCardProps) => {
  const t = useTranslations();

  if (!planGrant || !subscription) {
    return null;
  }

  const currentPlan = getPlanFromSubscription(subscription);
  const planLabelKey = getPlanDisplayLabelKey(currentPlan);
  const planDisplayLabel = planLabelKey ? t(planLabelKey) : '';
  const isFreePlan = currentPlan === SubscriptionPlan.Free;
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
    <div className="flex flex-col md:col-span-2 md:max-h-60 bg-intents-ux-box-backgroundColor rounded-xl border border-border gap-2 p-2 sm:p-4">
        <div className={clsx(
          "flex flex-col-reverse items-stretch gap-2",
          isActive
            ? "lg:flex-row lg:justify-between lg:items-center"
            : "md:flex-row md:justify-between md:items-center"
        )}>
          <div className="flex items-center gap-2">
            <text.strong as="title" size={0} className="block" text={t('builder_manageplan_plan_title')} />
            {isActive && <ActiveTag tooltipText={t('builder_manageplan_using_monthly')} />}
          </div>
          <div className={clsx("self-end", isActive && "lg:self-auto")}>
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
          <CreditProgressBar spent={planGrant.creditsSpent} max={planGrant.creditsMax} />
        { (creditPacks.length > 0 || (!isFreePlan && creditPacks.length === 0)) && currentPlan && currentPlan !== SubscriptionPlan.AiroPlus && (
          <Box orientation="horizontal" gap="md">
              { isFreePlan && creditPacks.length > 0 && (
                  <Button
                      design="primary"
                      data-partial='componentAiro'
                      data-eid={generateClickEID('manageplan.buttons.upgrade')}
                      size="sm"
                      text={t('builder_manageplan_upgrade')}
                      onClick={() => openPaywall('manage_plan.upgrade', 'upgrade', PAYWALL_ITC.UPGRADE)}
                  />
              )}
              { creditPacks.length > 0 && (
                  <Button
                      design="secondary"
                      data-partial='componentAiro'
                      data-eid={generateClickEID('manageplan.buttons.buy_credits')}
                      size="sm"
                      text={t('builder_manageplan_buy_credits')}
                      onClick={() => openPaywall('manage_plan.buy_credits', 'credits', PAYWALL_ITC.CREDITS)}
                  />
              )}
              { PAID_PLANS.includes(currentPlan) && autoRenewStatus?.autoRenew === true && onDowngradeClick && (
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
          </Box>
        )}
    </div>
  );
};

export default PlanCreditsCard;