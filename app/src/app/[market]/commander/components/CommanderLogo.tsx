'use client'

import Link from 'next/link'
import Tag from '@ux/tag'

import { AiroLogo } from '@/components/layout/AiroLogo'
import { useTranslations } from '@/hooks/useTranslations'
import { logClickEvent } from '@/utils/instrumentation'

interface CommanderLogoProps {
  appId: string | null
  source: 'commander-panel' | 'header'
}

export function CommanderLogo({ appId, source }: CommanderLogoProps) {
  const t = useTranslations()
  const clickContext = appId ? { appId } : undefined
  return (
    <div className="flex items-center gap-1" data-partial="componentAiro">
      <Link
        href="/"
        className="flex items-center"
        onClick={() => logClickEvent(`commander.${source}.airo_ai_link`, clickContext)()}
      >
        <AiroLogo className="relative" />
      </Link>
      <Tag emphasis="highlight" highcontrast>{t('builder_beta')}</Tag>
    </div>
  )
}
