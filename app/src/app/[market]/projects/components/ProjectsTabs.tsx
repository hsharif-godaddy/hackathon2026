'use client'

import clsx from 'clsx'

import type { ProjectTab } from '@/app/[market]/projects/constants'
import { useTranslations } from '@/hooks/useTranslations'

interface ProjectsTabsProps {
  active: ProjectTab
  counts: Record<ProjectTab, number>
  onChange: (tab: ProjectTab) => void
}

const TAB_DEFS: { id: ProjectTab; labelKey: string; fallback: string }[] = [
  { id: 'all', labelKey: 'builder_projects_tab_all', fallback: 'All Projects' },
  { id: 'website', labelKey: 'builder_projects_tab_websites', fallback: 'Website/Apps' },
  { id: 'logo', labelKey: 'builder_projects_tab_logo', fallback: 'Logo' },
]

export default function ProjectsTabs({ active, counts, onChange }: ProjectsTabsProps) {
  const t = useTranslations()

  return (
    <div
      role="tablist"
      aria-label={t('builder_common_projects', undefined, 'Projects')}
      className="flex items-center gap-6 border-b border-intents-ux-borderColor"
    >
      {TAB_DEFS.map((tab) => {
        const isActive = active === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            data-testid={`projects-tab-${tab.id}`}
            className={clsx(
              'relative -mb-px flex items-center gap-1.5 border-b-2 px-0.5 pb-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-ai text-ai'
                : 'border-transparent text-intents-ux-text-secondary hover:text-intents-ux-text-textColor'
            )}
          >
            <span>{t(tab.labelKey, undefined, tab.fallback)}</span>
          </button>
        )
      })}
    </div>
  )
}
