'use client'

import { useParams, useRouter } from 'next/navigation';
import clsx from 'clsx';
import Box from '@ux/box';
import { Site } from '@/stores/useSitesStore';

export default function SiteItem({site, dataEid}: {site: Site, dataEid?: string}) {
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
        <div className="size-12 shrink-0 rounded-md bg-intents-ux-boxHighContrast-backgroundColor transition-all duration-300" />
        <div className="flex flex-wrap">{site.name}</div>
      </Box>
    </button>
  )
}

export function SiteItemSkeleton() {
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
