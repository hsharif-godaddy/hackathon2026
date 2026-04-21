'use client'

import clsx from 'clsx';
import { useParams, useRouter } from 'next/navigation';
import Box from '@ux/box';
import AppsIcon from '@ux/icon/apps';
import PlusIcon from '@ux/icon/plus';
import text from '@ux/text';

import AppThumbnail from '@/app/[market]/apps/AppThumbnail';
import { useTranslations } from '@/hooks/useTranslations';
import { Site } from '@/stores/useSitesStore';
import { generateClickEID } from '@/utils/instrumentation';


export default function AppItem({site, dataEid}: {site: Site, dataEid?: string}) {
  const router = useRouter();
  const params = useParams();

  const currentSiteId = params?.id as string;

  return (
    <button
      key={site.id}
      onClick={() => router.push(`/develop/${site.id}?siteId=${site.id}`)}
      data-eid={dataEid ?? null}
      className={clsx(
        "w-full text-left leading-tight group rounded-sm hover:cursor-pointer transition-all duration-300", {
          "bg-intents-ux-boxLowContrast-backgroundColor": site.id === currentSiteId,
        }
      )}
    >
      <Box
        orientation="horizontal"
        gap="md"
        inlineAlignChildren="center"
        className="p-1 rounded-md group-hover:bg-intents-ux-boxLowContrast-backgroundColor transition-all duration-300"
      >
        <AppThumbnail siteId={site.id} siteName={site.name} size="xs" agentUrl={site.agent_url} />
        <div className="flex flex-wrap items-center gap-0.5">
          <text.span as="label" className="line-clamp-2">{site.name}</text.span>
        </div>
      </Box>
    </button>
  )
}

export function AppItemSkeleton() {
  return (
    <Box
      orientation="horizontal"
      gap="md"
      inlineAlignChildren="center"
      className="p-1 rounded-md w-full text-left group rounded-sm bg-intents-ux-boxLowContrast-backgroundColor animate-pulse"
    >
      <div className="size-6 shrink-0 rounded-md bg-intents-ux-boxLowContrast-borderColor" />
      <div className="w-12 h-2 bg-intents-ux-boxLowContrast-borderColor animate-pulse" />
    </Box>
  )
}

export function AppItemNew({ location }: { location?: string }) {
  const t = useTranslations();
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(`/`)}
      className="hover:cursor-pointer group text-left leading-tight"
      data-eid={generateClickEID(`${location}.apps_menu.new`)}
    >
      <Box
        orientation="horizontal"
        gap="md"
        inlineAlignChildren="center"
        className="p-1 rounded-md group-hover:bg-intents-ux-boxLowContrast-backgroundColor transition-all duration-300"
      >
        <div className="size-6 shrink-0 flex items-center justify-center border border-dashed border-primary rounded-md">
          <PlusIcon className="size-3.5 text-ai transition-all" />
        </div>
        <div>
          <text.span as="label">{t('builder_apps_empty_create')}</text.span>
        </div>
      </Box>
    </button>
  )
}

export function AppItemSeeAll({ location }: { location?: string }) {
  const t = useTranslations();
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(`/apps`)}
      className="hover:cursor-pointer group text-left leading-tight"
      data-eid={generateClickEID(`${location}.apps_menu.see_all`)}
    >
      <Box
        orientation="horizontal"
        gap="md"
        inlineAlignChildren="center"
        className="p-1 rounded-md group-hover:bg-intents-ux-boxLowContrast-backgroundColor transition-all duration-300"
      >
        <div className="size-6 shrink-0 flex items-center justify-center border border-primary rounded-md">
          <text.p className="text-ai"><AppsIcon className="size-3.5 text-ai" /></text.p>
        </div>
        <div>
          <text.span as="label">{t('builder_common_see_all')}</text.span>
        </div>
      </Box>
    </button>
  )
}
