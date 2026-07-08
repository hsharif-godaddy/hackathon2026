"use client";

import { useMemo } from "react";
import text from "@ux/text";
import TextLockup from "@ux/text-lockup";

import { useTranslations } from "@/hooks/useTranslations";
import type { SiteInfo } from "@/lib/control-plane/types";
import type { PaywallType } from "@/lib/paywall/shared";
import type { CreditGrant } from "@/types/credits";
import { SubscriptionPlan } from "@/types/credits";
import { getEffectiveCreditsSpent } from "@/utils/credits";
import CreditAddonsSection from "./CreditAddonsSection";
import MonthlyPlanSection from "./MonthlyPlanSection";
import PlanOverviewCard from "./PlanOverviewCard";
import TotalCreditsCard from "./TotalCreditsCard";

export interface ManagePlanLayoutProps {
  planGrant: CreditGrant | undefined;
  creditPacks: CreditGrant[];
  activeGrantId: string | undefined;
  locale: string | undefined;
  openPaywall: (source: string, type: PaywallType, itc?: string) => void;
  onDowngradeClick: () => void;
  sites: SiteInfo[];
  isSitesLoading: boolean;
  currentPlan: SubscriptionPlan;
  publishedCount: number;
  publishLimit: number | null;
}

export default function ManagePlanLayout({
  planGrant,
  creditPacks,
  activeGrantId,
  locale,
  openPaywall,
  onDowngradeClick,
  currentPlan,
  publishedCount,
  publishLimit,
}: ManagePlanLayoutProps) {
  const t = useTranslations();
  const { activePacks, usedExpiredPacks, totalCreditsSpent, totalCreditsMax } =
    useMemo(
      function computeGrantTotals() {
        const now: Date = new Date();
        const active: CreditGrant[] = creditPacks.filter(function filterActive(g) {
          const isExpiredByDate: boolean = g.useBefore
            ? new Date(g.useBefore) <= now
            : false;
          return g.isAvailable && !g.finalState && !isExpiredByDate;
        });
        const usedExpired: CreditGrant[] = creditPacks.filter(function filterUsedExpired(g) {
          const isExpiredByDate: boolean = g.useBefore
            ? new Date(g.useBefore) <= now
            : false;
          return !g.isAvailable || g.finalState != null || isExpiredByDate;
        });

        const planSpent: number = getEffectiveCreditsSpent(
          planGrant?.creditsSpent ?? 0,
          planGrant?.creditsMax ?? 0,
        );
        const packsSpent: number = active.reduce(
          (sum: number, g: CreditGrant) =>
            sum + getEffectiveCreditsSpent(g.creditsSpent, g.creditsMax),
          0,
        );
        const packsMax: number = active.reduce(
          (sum: number, g: CreditGrant) => sum + g.creditsMax,
          0,
        );

        return {
          activePacks: active,
          usedExpiredPacks: usedExpired,
          totalCreditsSpent: planSpent + packsSpent,
          totalCreditsMax: (planGrant?.creditsMax ?? 0) + packsMax,
        };
      },
      [creditPacks, planGrant],
    );

  const totalCreditsLeft: number = totalCreditsMax - totalCreditsSpent;

  return (
    <div className="flex flex-col gap-4">
      <TextLockup title={t("builder_manageplan_title")} size='2xl'>
        <text.p as="paragraph" className="mb-2" text={t("builder_manageplan_description_v2")} />
      </TextLockup>
      <PlanOverviewCard
        currentPlan={currentPlan}
        totalCreditsMax={totalCreditsMax}
        totalCreditsLeft={totalCreditsLeft}
        publishedCount={publishedCount}
        publishLimit={publishLimit}
        locale={locale}
        openPaywall={openPaywall}
      />

      <div className="flex flex-col gap-4 bg-intents-ux-box-backgroundColor rounded-xl border border-border p-4 lg:p-6">
        <TotalCreditsCard
          totalCreditsSpent={totalCreditsSpent}
          totalCreditsMax={totalCreditsMax}
          totalCreditsLeft={totalCreditsLeft}
        />

        <MonthlyPlanSection
          planGrant={planGrant}
          activeGrantId={activeGrantId}
          locale={locale}
          currentPlan={currentPlan}
          openPaywall={openPaywall}
          onDowngradeClick={onDowngradeClick}
        />

        <CreditAddonsSection
          activePacks={activePacks}
          usedExpiredPacks={usedExpiredPacks}
          activeGrantId={activeGrantId}
          locale={locale}
          openPaywall={openPaywall}
        />
      </div>
    </div>
  );
}
