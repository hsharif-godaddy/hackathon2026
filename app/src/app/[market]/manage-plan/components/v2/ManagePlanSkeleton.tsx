"use client";

import Skeleton from "@ux/skeleton";

export default function ManagePlanSkeletonV2() {
  return (
    <div className="flex flex-col gap-4">
      {/* Page header skeleton (TextLockup) */}
      <div className="flex flex-col gap-2">
        <Skeleton size="lg" width="220px" height="32px" />
        <Skeleton size="sm" width="360px" height="16px" />
      </div>

      {/* PlanOverviewCard skeleton */}
      <div className="flex flex-col bg-intents-ux-box-backgroundColor rounded-xl border border-border p-4 sm:p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-2 gap-5 lg:gap-7">
          {/* Col 1: plan name */}
          <div className="flex flex-col gap-1 justify-center">
            <Skeleton size="sm" width="90px" height="20px" />
            <Skeleton size="lg" width="140px" height="32px" />
            <Skeleton size="sm" width="200px" height="16px" />
          </div>

          {/* Col 2: two stat boxes side-by-side */}
          <div className="md:col-span-2 lg:col-span-1 flex flex-col md:flex-row gap-2">
            <div className="flex flex-1 flex-col gap-2 p-3 rounded-lg bg-ai-light-transparent">
              <Skeleton size="sm" width="90px" height="14px" />
              <Skeleton size="md" width="120px" height="20px" />
              <Skeleton size="sm" width="100%" height="28px" />
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3 rounded-lg bg-ai-light-transparent">
              <Skeleton size="sm" width="120px" height="14px" />
              <Skeleton size="md" width="80px" height="20px" />
              <Skeleton size="sm" width="90px" height="20px" />
            </div>
          </div>
        </div>
      </div>

      {/* Outer wrapper card: TotalCreditsCard + MonthlyPlanSection + CreditAddonsSection */}
      <div className="flex flex-col gap-4 bg-intents-ux-box-backgroundColor rounded-xl border border-border p-4 lg:p-6">
        {/* TotalCreditsCard skeleton (no inner border) */}
        <div className="flex flex-col gap-1">
          <Skeleton size="md" width="160px" height="24px" />
          <Skeleton size="sm" width="100%" height="16px" />
        </div>
        {/* TotalCreditsCard progress bar */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <Skeleton size="sm" width="140px" height="14px" />
            <Skeleton size="sm" width="80px" height="14px" />
          </div>
          <Skeleton size="sm" width="100%" height="12px" />
        </div>

        {/* MonthlyPlanSection skeleton (inner card) */}
        <div className="flex flex-col gap-3 bg-intents-ux-box-backgroundColor rounded-xl border border-border p-3 lg:p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <Skeleton size="md" width="180px" height="20px" />
              <Skeleton size="sm" width="60px" height="20px" />
            </div>
            <Skeleton size="sm" width="80px" height="28px" />
          </div>
          <Skeleton size="sm" width="180px" height="16px" />
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Skeleton size="sm" width="160px" height="14px" />
              <Skeleton size="sm" width="80px" height="14px" />
            </div>
            <Skeleton size="sm" width="100%" height="8px" />
          </div>
          <Skeleton size="sm" width="100px" height="20px" />
        </div>

        {/* CreditAddonsSection skeleton (inner card) */}
        <div className="flex flex-col gap-3 rounded-xl border border-border p-3 lg:p-4">
          <div className="flex items-center justify-between">
            <Skeleton size="md" width="140px" height="20px" />
            <Skeleton size="sm" width="16px" height="16px" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Skeleton size="sm" width="160px" height="14px" />
              <Skeleton size="sm" width="80px" height="14px" />
            </div>
            <Skeleton size="sm" width="100%" height="8px" />
          </div>
        </div>
      </div>
    </div>
  );
}
