'use client';

import Skeleton from '@ux/skeleton';

/**
 * Skeleton loader for the Manage Plan page
 */
export default function ManagePlanSkeleton() {
  return (
    <div className="bg-intents-ux-box-backgroundColor rounded-xl border border-border p-4 sm:p-6">
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <Skeleton size="md" width="160px" height="28px" />
        <Skeleton size="sm" width="96px" height="20px" />
      </div>

      {/* Reset info */}
      <div className="mb-4">
        <Skeleton size="sm" width="288px" height="20px" />
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mb-6">
        <Skeleton size="sm" width="128px" height="32px" />
        <Skeleton size="sm" width="128px" height="32px" />
      </div>

      {/* Grid layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Gauge placeholder */}
        <div className="flex flex-col items-center gap-2 bg-ai-light/4 border border-ai-light/20 rounded-lg p-4">
          <Skeleton size="sm" width="64px" height="20px" />
          <Skeleton size="md" width="144px" height="24px" />
          <Skeleton size="sm" width="112px" height="16px" />
          <Skeleton size="md" width="96px" height="24px" />
          <div className="my-2">
            <Skeleton rounding="full" width="120px" height="120px" />
          </div>
        </div>

        {/* Right: Credits list */}
        <div className="flex flex-col md:col-span-2">
          <div className="mb-2">
            <Skeleton size="sm" width="200px" height="16px" />
          </div>

          {/* Credit card skeletons */}
          <div className="flex flex-col">
            {[1, 2].map(function renderSkeleton(i) {
              return (
                <div
                  key={i}
                  className="flex items-center justify-between py-3 border-b border-border last:border-b-0"
                >
                  <div className="flex flex-col gap-1">
                    <Skeleton size="sm" width="128px" height="12px" />
                    <Skeleton size="md" width="160px" height="20px" />
                    <Skeleton size="sm" width="112px" height="12px" />
                  </div>
                  <div className="flex flex-col gap-1 w-full md:flex-1 md:max-w-[66%]">
                    <div className="self-end">
                      <Skeleton size="sm" width="80px" height="16px" />
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
  );
}
