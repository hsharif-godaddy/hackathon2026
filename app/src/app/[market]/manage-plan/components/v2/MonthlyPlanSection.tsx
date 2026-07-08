"use client";

import Button from "@ux/button";
import Tag from "@ux/tag";
import text from "@ux/text";

import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useEcommSubscriptionAutoRenewStatus } from "@/hooks/useEcommSubscriptionAutoRenewStatus";
import { useSubscriptionWithPolling } from "@/hooks/useSubscriptionWithPolling";
import { useTranslations } from "@/hooks/useTranslations";
import {
  isPaidPlanForGrants,
  PAYWALL_ITC,
  PAYWALL_TYPE,
  type PaywallType,
} from "@/lib/paywall/shared";
import type { CreditGrant } from "@/types/credits";
import { SubscriptionPlan } from "@/types/credits";
import {
  formatFullCreditDate,
  getEffectiveCreditsSpent,
  getPlanDisplayLabelKey,
} from "@/utils/credits";
import { generateClickEID } from "@/utils/instrumentation";
import ActiveTag from "./ActiveTag";
import { CreditsProgressBar } from "./CreditsProgressBar";

interface MonthlyPlanSectionProps {
  planGrant: CreditGrant | undefined;
  activeGrantId: string | undefined;
  locale: string | undefined;
  currentPlan: SubscriptionPlan;
  openPaywall: (source: string, type: PaywallType, itc?: string) => void;
  onDowngradeClick: () => void;
}

export default function MonthlyPlanSection({
  planGrant,
  activeGrantId,
  locale,
  currentPlan,
  openPaywall,
  onDowngradeClick,
}: MonthlyPlanSectionProps) {
  const t = useTranslations();
  const { subscription, builderEntitlementId } = useSubscriptionWithPolling();
  const { data: autoRenewStatus } = useEcommSubscriptionAutoRenewStatus(builderEntitlementId);
  
  if (!planGrant) {
    return null;
  }

  const isActive: boolean = activeGrantId === planGrant.id;
  const planLabelKey: string | undefined = getPlanDisplayLabelKey(currentPlan);
  const planDisplayLabel: string = planLabelKey ? t(planLabelKey) : "";
  const isPaidPlan: boolean = isPaidPlanForGrants(currentPlan);
  const isButtonDisabled: boolean = !builderEntitlementId;

  const resetDate: string | null = planGrant.useBefore
    ? formatFullCreditDate(planGrant.useBefore, locale)
    : null;

  return (
    <div className="flex flex-col gap-3 bg-intents-ux-box-backgroundColor rounded-xl border border-border p-3 lg:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2">
          <text.strong as="title" size={0}>
            {t("builder_manageplan_monthly_plan_credits")}
          </text.strong>
          {planDisplayLabel && (
            <Tag emphasis="info">
              {planDisplayLabel}
            </Tag>
          )}
        </div>
        
        <span className="hidden md:block">
          <Button
            design="primary"
            className='hidden md:block'
            size="sm"
            data-partial="componentAiro"
            data-eid={generateClickEID("manageplan.monthly.upgrade")}
            text={t("builder_manageplan_edit_plan")}
            onClick={() =>
              openPaywall(
                "manage_plan.monthly.upgrade",
                PAYWALL_TYPE.UPGRADE,
                PAYWALL_ITC.UPGRADE,
              )
            }
            disabled={isButtonDisabled}
          />
        </span>
      </div>

      <div className="flex flex-row gap-1">
        <div className="flex items-center gap-0.5">
          <text.p as="paragraph" size={-1}>
            {t("builder_manageplan_plan_credits_per_month", {
              count: planGrant.creditsMax,
            })}
          </text.p>
        <InfoTooltip content={t("builder_manageplan_plan_credits_tooltip")} />
        </div>
        {isActive && (
            <ActiveTag tooltipText={t("builder_manageplan_using_monthly")} />
        )}
      </div>

      <CreditsProgressBar
        label={resetDate ? t("builder_manageplan_credits_reset_on", { date: resetDate }) : undefined}
        spent={getEffectiveCreditsSpent(
          planGrant.creditsSpent,
          planGrant.creditsMax,
        )}
        left={planGrant.creditsMax - getEffectiveCreditsSpent(
          planGrant.creditsSpent,
          planGrant.creditsMax,
        )}
        max={planGrant.creditsMax}
        progressBarColor="color-ai-progress"
      />

      <div className="flex flex-row-reverse md:flex-row gap-2 items-center justify-end md:justify-start">
        {isPaidPlan &&
          autoRenewStatus?.autoRenew === true && (
            <Button
              design="inline"
              size="sm"
              data-partial="componentAiro"
              data-eid={generateClickEID("manageplan.monthly.downgrade")}
              text={t("builder_manageplan_downgrade_plan")}
              onClick={onDowngradeClick}
            />
          )}
          <span className="block md:hidden">
        <Button
            design="primary"
            className='block md:hidden'
            size="sm"
            data-partial="componentAiro"
            data-eid={generateClickEID("manageplan.monthly.upgrade")}
            text={t("builder_manageplan_edit_plan")}
            onClick={() =>
              openPaywall(
                "manage_plan.monthly.upgrade",
                PAYWALL_TYPE.UPGRADE,
                PAYWALL_ITC.UPGRADE,
              )
            }
            disabled={isButtonDisabled}
          />
          </span>
      </div>
    </div>
  );
}
