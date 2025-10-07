'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useAuth } from '@/hooks/useAuth';
import { useSites } from '@/stores/useSitesStore';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/lib/shadcn/popover"
import { generateClickEID } from '@/utils/instrumentation';
import text from '@ux/text';
import Box from '@ux/box';
import ChevronDownIcon from '@ux/icon/chevron-down';

export default function SiteSelector() {
  const router = useRouter();
  const params = useParams();
  const {
    isAuthenticated,
    isLoading: isLoadingAuth
  } = useAuth();

  const {
    sites,
    isLoading: isLoadingSites,
  } = useSites()

  const [open, setOpen] = useState(false);

  const isLoading = isLoadingAuth || isLoadingSites;
  if (!isAuthenticated || isLoading) {
    return null;
  }

  // Get current site from URL params
  const currentSiteId = params?.id as string;
  const currentSite = currentSiteId ? sites.find(site => site.id === currentSiteId) : null;
  const displayTitle = currentSite?.name || "My Sites";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="hover:cursor-pointer">
        <Box orientation="horizontal" gap="sm">
          <text.p className="truncate max-w-[150px]">{displayTitle}</text.p>
          <ChevronDownIcon
            className={clsx(
              "transition-transform duration-300", {
                "scale-y-[-1]": open,
              }
            )} />
        </Box>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-2">
        <div className="flex flex-col gap-2">
          {sites.map((site) => (
            <button
              key={site.id}
              onClick={() => router.push(`/develop/${site.id}?siteId=${site.id}`)}
              data-eid={generateClickEID('sites.site.edit')}
              className={clsx(
                "w-full text-left group rounded-sm hover:cursor-pointer transition-all duration-300", {
                  "bg-intents-ux-boxLowContrast-backgroundColor": site.id === currentSiteId,
                }
              )}
            >
              <Box orientation="horizontal" gap="md" inlineAlignChildren="center" className="rounded-md leading-tight group-hover:bg-intents-ux-boxLowContrast-backgroundColor transition-all duration-300">
                <div className="size-12 shrink-0 rounded-md bg-intents-ux-boxLowContrast-backgroundColor transition-all duration-300" />
                <div className="flex flex-wrap">{site.name}</div>
              </Box>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
