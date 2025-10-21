'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useAuth } from '@/hooks/useAuth';
import { useSites } from '@/stores/useSitesStore';
import SiteItem, { SiteItemNew } from '@/components/layout/SiteItem';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/lib/shadcn/popover"
import text from '@ux/text';
import Box from '@ux/box';
import ChevronDownIcon from '@ux/icon/chevron-down';
import { generateClickEID } from '@/utils/instrumentation';

export default function SiteSelector({ location }: { location?: string }) {
  const router = useRouter();
  const params = useParams();
  const {
    isAuthenticated,
    isLoading: isLoadingAuth
  } = useAuth();

  const {
    sites,
    isLoading: isLoadingSites,
  } = useSites({ enabled: isAuthenticated })

  const [open, setOpen] = useState(false);

  const isLoading = isLoadingAuth || isLoadingSites;

  if (!isAuthenticated) {
    return null;
  }

  // Get current site from URL params
  const currentSiteId = params?.id as string;
  const currentSite = currentSiteId ? sites.find(site => site.id === currentSiteId) : null;
  const displayTitle = currentSite?.name || "My Sites";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="hover:cursor-pointer"
        onClick={() => (sites.length < 1 || isLoading) ? router.push('/sites') : null}
      >
        <Box orientation="horizontal" gap="sm">
          <text.p className="truncate max-w-[150px]">{displayTitle}</text.p>
          {sites.length > 0 && (
            <ChevronDownIcon
              className={clsx(
                "transition-transform duration-300", {
                  "scale-y-[-1]": open,
                }
              )}
            />
          )}
        </Box>
      </PopoverTrigger>
      {sites.length > 0 && (
        <PopoverContent align="end" className="w-[300px] p-2">
          <div className="flex flex-col gap-2">
            {sites.map((site) => (
              <SiteItem
                key={site.id}
                site={site}
                dataEid={generateClickEID('sites.site.edit')}
              />
            ))}
            { location !== 'homepage' && <SiteItemNew /> }
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}
