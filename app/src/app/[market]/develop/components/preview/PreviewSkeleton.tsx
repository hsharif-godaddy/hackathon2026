import StaticSkeleton from '@/app/[market]/develop/components/StaticSkeleton'

export default function PreviewSkeleton({ testId }: { testId: string }) {
  return (
    <div
      data-testid={testId}
      className="flex-1 flex flex-col items-center justify-center gap-8 mt-6 bg-intents-ux-boxLowContrast-backgroundColor rounded-lg mx-1 md:mr-2.5"
    >
      <div className="flex flex-col items-center gap-4">
        <StaticSkeleton width="96px" height="96px" />
        <StaticSkeleton width="200px" height="24px" />
      </div>
      <div className="w-full max-w-2xl px-3">
        <div className="min-h-24 p-2">
          <div className="rounded-lg shadow-sm px-4 py-4 flex gap-2 bg-intents-ux-box-backgroundColor">
            <StaticSkeleton rounding="full" width="24px" height="24px" className="shrink-0 mt-0.5" />
            <div className="flex flex-col gap-2 flex-1">
              <StaticSkeleton width="50%" height="14px" />
              <StaticSkeleton width="95%" height="12px" />
              <StaticSkeleton width="75%" height="12px" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
