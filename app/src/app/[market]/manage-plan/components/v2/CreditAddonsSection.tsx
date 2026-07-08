"use client";

import clsx from "clsx";
import { motion } from "framer-motion";
import { useState } from "react";
import Button from "@ux/button";
import ChevronDownIcon from "@ux/icon/chevron-down";
import ChevronUpIcon from "@ux/icon/chevron-up";
import text from "@ux/text";

import { CollapsibleCardBody } from "@/app/[market]/manage-plan/components/CollapsibleCardBody";
import { useSubscriptionWithPolling } from "@/hooks/useSubscriptionWithPolling";
import { useTranslations } from "@/hooks/useTranslations";
import { PAYWALL_ITC, PAYWALL_TYPE, type PaywallType } from "@/lib/paywall/shared";
import SiteBuild from "@/svgs/site-build";
import type { CreditGrant } from "@/types/credits";
import { getEffectiveCreditsSpent } from "@/utils/credits";
import { generateClickEID } from "@/utils/instrumentation";
import CreditGrantRow from "./CreditGrantRow";
import { CreditsProgressBar } from "./CreditsProgressBar";

interface CreditAddonsSectionProps {
  activePacks: CreditGrant[];
  usedExpiredPacks: CreditGrant[];
  activeGrantId: string | undefined;
  locale: string | undefined;
  openPaywall: (source: string, type: PaywallType, itc?: string) => void;
}

export default function CreditAddonsSection({
  activePacks,
  usedExpiredPacks,
  activeGrantId,
  locale,
  openPaywall,
}: CreditAddonsSectionProps) {
  const t = useTranslations();
  const { builderEntitlementId } = useSubscriptionWithPolling();
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showUsedExpired, setShowUsedExpired] = useState<boolean>(false);
  const isButtonDisabled: boolean = !builderEntitlementId;

  const activePacksSpent: number = activePacks.reduce(
    (sum: number, g: CreditGrant) =>
      sum + getEffectiveCreditsSpent(g.creditsSpent, g.creditsMax),
    0,
  );
  const activePacksMax: number = activePacks.reduce(
    (sum: number, g: CreditGrant) => sum + g.creditsMax,
    0,
  );

  const hasNoPacks: boolean =
    activePacks.length === 0 && usedExpiredPacks.length === 0;

  if (hasNoPacks) {
    return (
      <div className="flex flex-col rounded-xl border border-border p-3 lg:p-4">
        <button
          type="button"
          className="flex items-center justify-between w-full cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          aria-label={
            isExpanded ? t("builder_common_collapse") : t("builder_common_expand")
          }
        >
          <text.strong as="title" size={0}>
            {t("builder_manageplan_creditpacks_title")}
          </text.strong>
          <motion.span
            className="inline-flex"
            initial={false}
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          >
            <ChevronDownIcon className="w-4 h-4" />
          </motion.span>
        </button>

        <CollapsibleCardBody isExpanded={isExpanded}>
          <div className="flex flex-row items-center gap-4">
            <div className="flex flex-col items-start gap-2 flex-1">
              <text.p as="paragraph" size={-1}>
                {t("builder_manageplan_creditpacks_empty_description")}
              </text.p>
              <Button
                design="secondary"
                size="sm"
                data-partial="componentAiro"
                data-eid={generateClickEID("manageplan.addons.buy_credits")}
                text={t("builder_manageplan_buy_credits")}
                onClick={() =>
                  openPaywall(
                    "manage_plan.addons.buy_credits",
                    PAYWALL_TYPE.CREDITS,
                    PAYWALL_ITC.CREDITS,
                  )
                }
                disabled={isButtonDisabled}
              />
            </div>
            <div className="hidden md:block w-24 flex-shrink-0 [&>svg]:w-full [&>svg]:h-auto">
              <SiteBuild />
            </div>
          </div>
        </CollapsibleCardBody>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-intents-ux-box-backgroundColor rounded-xl border border-border p-3 lg:p-4">
      <button
        type="button"
        className="flex items-center justify-between w-full cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={
          isExpanded
            ? t("builder_common_collapse")
            : t("builder_common_expand")
        }
      >
        <text.strong as="title" size={0}>
          {t("builder_manageplan_creditpacks_title")}
        </text.strong>
        <motion.span
          className="inline-flex"
          initial={false}
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        >
          <ChevronDownIcon className="w-4 h-4" />
        </motion.span>
      </button>

      {activePacksMax > 0 && (
        <div className={ clsx(isExpanded && "border-b border-border pb-4", activePacksMax > 0 && "mt-3")}>
          <CreditsProgressBar label={t("builder_manageplan_active_packs_summary", {
            count: activePacks.length,
          })} spent={activePacksSpent} left={activePacksMax - activePacksSpent} max={activePacksMax} progressBarColor="color-ai-progress-light" />
        </div>
      )}

      <CollapsibleCardBody isExpanded={isExpanded}>
        <div className="flex flex-col pt-3 gap-3">
          {activePacks.map(function renderActiveGrant(grant: CreditGrant) {
            return (
              <CreditGrantRow
                key={grant.id}
                grant={grant}
                isActive={activeGrantId === grant.id}
                locale={locale}
              />
            );
          })}

          {usedExpiredPacks.length > 0 && (
            <div className="flex flex-col gap-3 mt-1">
              <button
                type="button"
                className="flex items-center gap-1 cursor-pointer"
                onClick={() => setShowUsedExpired(!showUsedExpired)}
                aria-expanded={showUsedExpired}
              >
                <text.span as="caption">
                  {showUsedExpired
                    ? t("builder_manageplan_hide_used_expired")
                    : t("builder_manageplan_show_used_expired")}
                </text.span>
                {showUsedExpired ? (
                  <ChevronUpIcon className="w-3 h-3" />
                ) : (
                  <ChevronDownIcon className="w-3 h-3" />
                )}
              </button>

              <CollapsibleCardBody isExpanded={showUsedExpired}>
                <div className="flex flex-col gap-3 pb-3">
                  {usedExpiredPacks.map(function renderUsedExpiredGrant(
                    grant: CreditGrant,
                  ) {
                    return (
                      <CreditGrantRow
                        key={grant.id}
                        grant={grant}
                        isActive={false}
                        locale={locale}
                      />
                    );
                  })}
                </div>
              </CollapsibleCardBody>
            </div>
          )}
        </div>
      </CollapsibleCardBody>
    </div>
  );
}
