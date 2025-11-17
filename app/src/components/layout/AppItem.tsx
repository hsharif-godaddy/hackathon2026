'use client'

import { useParams, useRouter } from 'next/navigation';
import clsx from 'clsx';
import Box from '@ux/box';
import { generateClickEID } from '@/utils/instrumentation';
import { Site } from '@/stores/useSitesStore';
import PlusIcon from '@ux/icon/plus';
import text from '@ux/text';
import AppThumbnail from '@/app/apps/AppThumbnail';

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
        "w-full text-left group rounded-sm hover:cursor-pointer transition-all duration-300", {
          "bg-intents-ux-boxLowContrast-backgroundColor": site.id === currentSiteId,
        }
      )}
    >
      <Box
        orientation="horizontal"
        gap="md"
        inlineAlignChildren="center"
        className="p-2 rounded-md leading-tight group-hover:bg-intents-ux-boxLowContrast-backgroundColor transition-all duration-300"
      >
        <AppThumbnail siteId={site.id} siteName={site.name} size="xs" />
        <div className="flex flex-wrap">{site.name}</div>
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
      className="p-2 rounded-md w-full text-left group rounded-sm bg-intents-ux-boxLowContrast-backgroundColor animate-pulse"
    >
      <div className="size-12 shrink-0 rounded-md bg-intents-ux-boxLowContrast-borderColor " />
      <div className="w-24 h-4 bg-intents-ux-boxLowContrast-borderColor animate-pulse"></div>
    </Box>
  )
}

export function AppItemNew({ location }: { location?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(`/`)}
      className="px-2 hover:cursor-pointer group"
      data-eid={generateClickEID(`${location}.apps_menu.new`)}
    >
      <Box
        orientation="horizontal"
        gap="md"
        inlineAlignChildren="center"
      >
        <div className="size-12 shrink-0 flex items-center justify-center">
          <PlusIcon className="size-7 text-ai group-hover:rotate-90 transition-all" />
        </div>
        <div>
          <text.p>Create a new app</text.p>
        </div>
      </Box>
    </button>
  )
}
