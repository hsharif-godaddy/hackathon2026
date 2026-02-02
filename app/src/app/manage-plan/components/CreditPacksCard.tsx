'use client';

import Box from '@ux/box';
import Button from '@ux/button';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import { type CreditGrant, SubscriptionPlan } from '@/types/credits';
import { generateClickEID } from '@/utils/instrumentation';
import CreditGrantRow from './CreditGrantRow';
import RidingArrow from '../../../svgs/riding-arrow';
import SiteBuild from '../../../svgs/site-build';

interface CreditPacksCardProps {
  creditPacks: CreditGrant[];
  subscriptionPlan?: SubscriptionPlan;
  activeGrantId?: string;
  locale?: string;
  onOpenPaywall: (source: string) => void;
}

/**
 * Credit packs card displaying purchased credit packs
 */
export default function CreditPacksCard({ creditPacks, subscriptionPlan, activeGrantId, locale, onOpenPaywall }: CreditPacksCardProps) {
  const t = useTranslations();

  const hasNoPlanAndNoCredits = creditPacks.length === 0 && (subscriptionPlan === SubscriptionPlan.Free || subscriptionPlan === SubscriptionPlan.None);

  if (hasNoPlanAndNoCredits || creditPacks.length === 0) {
    return (
      <div className="flex flex-col md:col-span-2 rounded-lg border border-border p-5">
        <div className="flex flex-col md:flex-row items-center">
          <div className="flex-1">
            <text.strong as="title" size={0} className="block mb-2" text={t('builder_manageplan_creditpacks_empty_title')} />
            <text.p as="paragraph" className="mb-4" text={hasNoPlanAndNoCredits ? t('builder_manageplan_creditpacks_empty_plan_description') : t('builder_manageplan_creditpacks_empty_description')} />
            { hasNoPlanAndNoCredits ? (
                <Box orientation="horizontal" gap="md">
                    <Button
                      design="primary"
                      data-partial='componentAiro'
                      data-eid={generateClickEID('manage_plan.upgrade')}
                      size="sm"
                      text={t('builder_manageplan_upgrade')} onClick={() => onOpenPaywall('manage_plan.upgrade')}
                    />
                    <Button
                      design="secondary"
                      data-partial='componentAiro'
                      data-eid={generateClickEID('manage_plan.buy_credits')}
                      size="sm" text={t('builder_manageplan_buy_credits')}
                      onClick={() => onOpenPaywall('manage_plan.buy_credits')}
                    />
                </Box>
            ) : (
                <Button
                  design="secondary"
                  data-partial='componentAiro'
                  data-eid={generateClickEID('manage_plan.buy_credits')}
                  size="sm" text={t('builder_manageplan_buy_credits')}
                  onClick={() => onOpenPaywall('manage_plan.buy_credits')}
                />
            )}
          </div>
          {hasNoPlanAndNoCredits ? <RidingArrow /> : <SiteBuild />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:col-span-2 md:max-h-60">
      <text.p as="paragraph" className="mb-2 flex-shrink-0" text={t('builder_manageplan_credits_description')} />

      <div className="flex flex-col flex-1 min-h-0 overflow-y-auto pr-1">
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
    </div>
  );
}
