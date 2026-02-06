'use client';

import Skeleton from '@ux/skeleton';

/**
 * Skeleton loader for the Manage Plan page
 */
export default function ManagePlanSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {/* Page title */}
      <Skeleton size="lg" width="200px" height="32px" />
      {/* Page description */}
      <Skeleton size="sm" width="480px" height="20px" className="mb-2" />

      {/* Grid layout matching page structure */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {/* Left: Total Credits Card */}
        <div className="flex flex-col items-center gap-2 bg-ai-light/4 border border-ai-light/20 rounded-lg p-4">
          <Skeleton size="sm" width="140px" height="20px" />
          <Skeleton size="md" width="100px" height="28px" />
          <div className="my-2">
            <Skeleton rounding="full" width="120px" height="120px" />
          </div>
        </div>

        {/* Right: Plan Credits Card + Addon Card */}
        <div className="md:col-span-2 grid grid-cols-1 gap-4">
          {/* Plan Credits Card */}
          <div className="flex flex-col bg-intents-ux-box-backgroundColor rounded-xl border border-border gap-2 p-2 sm:p-4">
            {/* Header row with title, active tag, and plan badge */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton size="md" width="180px" height="24px" />
                <Skeleton size="sm" width="64px" height="20px" />
              </div>
              <Skeleton size="sm" width="100px" height="24px" />
            </div>
            {/* Reset info */}
            <Skeleton size="sm" width="380px" height="18px" />
            {/* Progress bar */}
            <div className="flex flex-col gap-1">
              <div className="self-end">
                <Skeleton size="sm" width="60px" height="16px" />
              </div>
              <Skeleton size="sm" width="100%" height="16px" />
            </div>
            {/* Action buttons */}
            <div className="flex gap-3">
              <Skeleton size="sm" width="100px" height="32px" />
              <Skeleton size="sm" width="120px" height="32px" />
            </div>
          </div>

          {/* Addon Credits Card */}
          <div className="flex flex-col bg-intents-ux-box-backgroundColor rounded-xl border border-border p-2 sm:p-4">
            {/* Title */}
            <Skeleton size="md" width="120px" height="24px" className="mb-2" />
            {/* Description */}
            <Skeleton size="sm" width="300px" height="18px" className="mb-2" />
            {/* Credit grant rows */}
            <div className="flex flex-col">
              {[1, 2].map(function renderSkeleton(i) {
                return (
                  <div
                    key={i}
                    className="flex items-center justify-between py-3 border-b border-border last:border-b-0"
                  >
                    <div className="flex flex-col gap-1">
                      <Skeleton size="sm" width="80px" height="12px" />
                      <Skeleton size="md" width="120px" height="18px" />
                      <Skeleton size="sm" width="100px" height="12px" />
                    </div>
                    <div className="flex flex-col gap-1 flex-1 max-w-[50%] ml-4">
                      <div className="self-end">
                        <Skeleton size="sm" width="60px" height="14px" />
                      </div>
                      <Skeleton size="sm" width="100%" height="16px" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
