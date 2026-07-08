"use client";

import { useRouter } from "next/navigation";
import Button from "@ux/button";
import Tag from "@ux/tag";
import text from "@ux/text";

import { useEcommSubscriptionAutoRenewStatus } from "@/hooks/useEcommSubscriptionAutoRenewStatus";
import { useSubscriptionWithPolling } from "@/hooks/useSubscriptionWithPolling";
import { useTranslations } from "@/hooks/useTranslations";
import {
  canUpgradePlan,
  PAYWALL_ITC,
  PAYWALL_TYPE,
  type PaywallType,
} from "@/lib/paywall/shared";
import { SubscriptionPlan } from "@/types/credits";
import { formatFullCreditDate, getPlanLabelKey } from "@/utils/credits";
import { generateClickEID } from "@/utils/instrumentation";

interface PlanOverviewCardProps {
  currentPlan: SubscriptionPlan;
  totalCreditsMax: number;
  totalCreditsLeft: number;
  publishedCount: number;
  publishLimit: number | null;
  locale: string | undefined;
  openPaywall: (source: string, type: PaywallType, itc?: string) => void;
}

export default function PlanOverviewCard({
  currentPlan,
  totalCreditsMax,
  totalCreditsLeft,
  publishedCount,
  publishLimit,
  locale,
  openPaywall,
}: PlanOverviewCardProps) {
  const t = useTranslations();
  const { subscription, builderEntitlementId } = useSubscriptionWithPolling();
  const { data: autoRenewStatus } = useEcommSubscriptionAutoRenewStatus(builderEntitlementId);

  const router = useRouter();
  const planLabelKey: string | undefined = getPlanLabelKey(currentPlan);
  const planDisplayLabel: string = planLabelKey ? t(planLabelKey) : "";
  const isButtonDisabled: boolean = !builderEntitlementId;

  const billingFrequencyKey: string | undefined =
    autoRenewStatus?.term?.termType === "YEAR"
      ? "builder_manageplan_billed_yearly"
      : autoRenewStatus?.term?.termType === "MONTH"
        ? "builder_manageplan_billed_monthly"
        : undefined;

  const billingTerm: string = subscription?.renewsAt
    ? billingFrequencyKey
      ? t("builder_manageplan_billing_term", {
          frequency: t(billingFrequencyKey),
          date: formatFullCreditDate(subscription.renewsAt, locale),
        })
      : t("builder_manageplan_renews_on", {
          date: formatFullCreditDate(subscription.renewsAt, locale),
        })
    : "";

  return (
    <div className="flex flex-col bg-intents-ux-box-backgroundColor rounded-xl border border-border p-4 sm:p-5 shadow-md">
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-2 gap-5 lg:gap-7">
        <div className="flex flex-col gap-1 justify-center">
          <Tag emphasis="neutral" className="w-fit">
            {t("builder_manageplan_current_plan")}
          </Tag>
          <text.h1 as="title" size={5} className="mt-1">
            {planDisplayLabel}
          </text.h1>
          {billingTerm && (
            <text.p as="paragraph" size={-1} emphasis="passive">
              {billingTerm}
            </text.p>
          )}
        </div>

        <div className="md:col-span-2 lg:col-span-1 flex flex-col md:flex-row justify-end gap-2">
          <div className="flex flex-1 flex-col gap-2 p-3 items-start justify-between rounded-lg bg-ai-light-transparent">
            <div className="flex flex-col gap-2">
              <text.span as="caption" emphasis="passive">
                {t("builder_manageplan_total_credits")}
              </text.span>
              <div className="flex items-center gap-0.5">
                <text.strong as="heading" size={-1}>
                  {totalCreditsLeft.toLocaleString()}
                </text.strong>
                <text.span as="paragraph" emphasis="passive" size={-1}>
                  {t("builder_manageplan_overview_left", { max: totalCreditsMax.toLocaleString() })}
                </text.span>
              </div>
            </div>
            <Button
              design="secondary"
              stretch
              size="sm"
              data-partial="componentAiro"
              data-eid={generateClickEID("manageplan.overview.buy_credits")}
              text={t("builder_manageplan_buy_credits")}
              onClick={() =>
                openPaywall(
                  "manage_plan.overview.buy_credits",
                  PAYWALL_TYPE.CREDITS,
                  PAYWALL_ITC.CREDITS,
                )
              }
              disabled={isButtonDisabled}
            />
          </div>

          <div className="flex flex-1 flex-col gap-2 p-3 items-start rounded-lg bg-ai-light-transparent">
            <div className="flex md:flex-col lg:flex-row lg:items-center justify-between w-full">
              <text.span as="caption" emphasis="passive">
                {t("builder_manageplan_published_projects")}
              </text.span>
              <span className="md:hidden">
                <Button
                  design="inline"
                  size="sm"
                  data-partial="componentAiro"
                  data-eid={generateClickEID("manageplan.overview.my_projects")}
                  text={t("builder_manageplan_my_projects")}
                  onClick={() => router.push("/apps")}
                />
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              <text.strong as="heading" size={-1}>
                {publishedCount}
              </text.strong>
              { publishLimit !== null && publishLimit > 0 && (
                <text.span as="paragraph" size={-1} emphasis="passive">
                  {t("builder_manageplan_published_of_limit", { limit: publishLimit })}
                </text.span>
              )}
            </div>
            <span className="hidden md:block">
              <Button
                design="inline"
                size="sm"
                data-partial="componentAiro"
                data-eid={generateClickEID("manageplan.overview.my_projects")}
                text={t("builder_manageplan_my_projects")}
                onClick={() => router.push("/apps")}
              />
            </span>
            {canUpgradePlan(currentPlan) && (
              <Button
                design="primary"
                size="sm"
                stretch
                data-partial="componentAiro"
                data-eid={generateClickEID("manageplan.overview.upgrade_plan")}
                text={t("builder_manageplan_upgrade_plan")}
                onClick={() =>
                  openPaywall(
                    "manage_plan.overview.upgrade_plan",
                    PAYWALL_TYPE.UPGRADE,
                    PAYWALL_ITC.UPGRADE,
                  )
                }
                disabled={isButtonDisabled}
              />
            )}
          </div>
      </div>
      </div>
    </div>
  );
}
