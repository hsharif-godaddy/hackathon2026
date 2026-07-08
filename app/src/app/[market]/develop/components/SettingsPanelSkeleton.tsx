import StaticSkeleton from '@/app/[market]/develop/components/StaticSkeleton'
import { SettingsSection } from '@/app/[market]/develop/components/types'

function DatabaseSkeleton({ className }: { className?: string }) {
  return (
    <div className={`@container flex flex-col gap-2 ${className ?? ''}`.trim()}>
      <StaticSkeleton width="35%" height="28px" />
      <StaticSkeleton width="100%" height="72px" />
      <div className="flex flex-col gap-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center justify-between bg-intents-ux-box-backgroundColor rounded-lg px-2 py-1.5">
            <div className="flex items-center gap-2">
              <StaticSkeleton width="24px" height="24px" rounding="full" />
              <StaticSkeleton width="180px" height="20px" />
            </div>
            <StaticSkeleton width="105px" height="36px" className="rounded-md" />
          </div>
        ))}
      </div>
    </div>
  )
}

function DomainSkeleton({ className }: { className?: string }) {
  return (
    <div className={`h-full flex flex-col overflow-y-auto w-full px-1.5 pb-2 md:px-0.5 md:max-w-7xl mx-auto ${className ?? ''}`.trim()}>
      <div className="@container flex flex-col gap-1">
        <StaticSkeleton width="40%" height="28px" className="mt-1" />
        <StaticSkeleton width="100%" height="24px" className="mb-1" />
        <StaticSkeleton width="20%" height="20px" />
        <StaticSkeleton width="100%" height="56px" className="rounded-md" />
        <StaticSkeleton width="100%" height="42px" className="mb-1" />
        <StaticSkeleton width="60%" height="24px" className="mb-1" />
      </div>
      <div className="@container flex flex-col gap-1">
        <StaticSkeleton width="40%" height="28px" className="mt-2" />
        <StaticSkeleton width="100%" height="48px" className="mb-1" />
      </div>
    </div>
  )
}

function ProjectSkeleton({ className }: { className?: string }) {
  return (
    <div className={`h-full flex flex-col overflow-y-auto w-full px-1.5 pb-2 md:px-0.5 md:max-w-7xl mx-auto ${className ?? ''}`.trim()}>
      <div className="@container flex flex-col gap-3">
        {[146, 164, 206].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <StaticSkeleton width="30%" height="28px" />
            <StaticSkeleton width="100%" height="48px" />
            <div className="flex justify-end">
              <StaticSkeleton width={`${i}px`} height="36px" className="rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SecretRowSkeleton({ keyWidth }: { keyWidth: string }) {
  return (
    <div className="p-2 border-b border-intents-ux-box-borderColor">
      <div className="flex flex-col gap-1.5 @md:flex-row @md:items-center @md:gap-2 min-w-0">
        <div className="w-full min-w-0 @md:w-[min(38%,14rem)] @md:shrink-0">
          <StaticSkeleton width={keyWidth} height="30px" className="rounded-md" />
        </div>
        <div className="min-w-0 flex-1">
          <StaticSkeleton width="100%" height="30px" className="rounded-md" />
        </div>
      </div>
      <div className="mt-1.5">
        <StaticSkeleton width="124px" height="20px" rounding="full" />
      </div>
    </div>
  )
}

function SecretsSkeleton({ className }: { className?: string }) {
  return (
    <div className={`@container flex flex-col gap-3 ${className ?? ''}`.trim()}>
      <StaticSkeleton width="152px" height="28px" />
      <StaticSkeleton width="100%" height="24px" />
      <div className="flex justify-end">
        <StaticSkeleton width="113px" height="38px" />
      </div>
      <div className="border-2 border-dashed border-intents-ux-box-borderColor rounded-lg p-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
          <StaticSkeleton width="100%" height="36px" className="rounded-md" />
          <StaticSkeleton width="100%" height="36px" className="rounded-md" />
        </div>
      </div>
      <div className="border border-intents-ux-box-borderColor rounded-lg overflow-hidden">
        {['100%', '80px', '190px', '210px', '220px'].map((w, i) => (
          <SecretRowSkeleton key={i} keyWidth={w} />
        ))}
      </div>
    </div>
  )
}

function CommerceSkeleton({ className }: { className?: string }) {
  return (
    <div className={`@container flex flex-col gap-2.5 ${className ?? ''}`.trim()}>
      <div className="flex gap-1">
        <StaticSkeleton width="112px" height="36px" className="rounded-md" />
        <StaticSkeleton width="96px" height="36px" className="rounded-md" />
      </div>
      <div className="flex flex-col gap-1">
        <StaticSkeleton width="42%" height="28px" />
        <StaticSkeleton width="100%" height="22px" />
      </div>
      <div className="grid gap-1.5 @2xl:grid-cols-3">
        {[132, 154, 146].map((width) => (
          <div key={width} className="flex flex-col gap-1 rounded-lg border border-intents-ux-box-borderColor p-1.5">
            <StaticSkeleton width="28px" height="28px" rounding="full" />
            <StaticSkeleton width={`${width}px`} height="22px" />
            <StaticSkeleton width="100%" height="18px" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-intents-ux-box-borderColor px-1.5 py-1.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <StaticSkeleton width={i % 2 === 0 ? '52%' : '38%'} height="20px" />
              <StaticSkeleton width="78%" height="18px" />
            </div>
            <StaticSkeleton width="18px" height="18px" rounding="full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function DefaultSkeleton({ className }: { className?: string }) {
  return (
    <div className={`@container flex flex-col gap-6 ${className ?? ''}`.trim()}>
      <div className="flex flex-col gap-3">
        <StaticSkeleton width="50%" height="28px" />
        <StaticSkeleton width="100%" height="48px" />
        <div className="flex justify-end">
          <StaticSkeleton width="35%" height="38px" />
        </div>
      </div>
    </div>
  )
}

export default function SettingsPanelSkeleton({ settingsSection, className }: { settingsSection?: SettingsSection, className?: string }) {
  switch (settingsSection) {
    case SettingsSection.PROJECT:
      return <ProjectSkeleton className={className} />
    case SettingsSection.DOMAIN:
      return <DomainSkeleton className={className} />
    case SettingsSection.DATABASE:
      return <DatabaseSkeleton className={className} />
    case SettingsSection.COMMERCE:
      return <CommerceSkeleton className={className} />
    case SettingsSection.SECRETS:
      return <SecretsSkeleton className={className} />
    default:
      return <DefaultSkeleton className={className} />
  }
}
