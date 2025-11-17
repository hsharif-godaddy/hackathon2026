'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useSites } from '@/stores/useSitesStore';
import AppItem, { AppItemNew } from '@/components/layout/AppItem';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/lib/shadcn/popover"
import text from '@ux/text';
import Box from '@ux/box';
import ChevronDownIcon from '@ux/icon/chevron-down';
import { generateClickEID } from '@/utils/instrumentation';

export default function AppSelector({ location }: { location?: string }) {
  const router = useRouter();
  const params = useParams();
  const {
    isAuthenticated,
    isLoading: isLoadingAuth
  } = useAuthContext();

  const {
    sites,
    isLoading: isLoadingSites,
  } = useSites({ enabled: isAuthenticated })

  // Auto-expand dropdown on homepage if user has apps
  const [open, setOpen] = useState(false);

  // Open dropdown on homepage once sites are loaded
  useEffect(() => {
    if (location === 'homepage' && !isLoadingSites && sites.length > 0) {
      setOpen(true);
    }
  }, [location, isLoadingSites, sites.length]);

  const isLoading = isLoadingAuth || isLoadingSites;

  if (!isAuthenticated) {
    return null;
  }

  // Get current site from URL params
  const currentSiteId = params?.id as string;
  const currentSite = currentSiteId ? sites.find(site => site.id === currentSiteId) : null;
  const displayTitle = currentSite?.name || "My Apps";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="hover:cursor-pointer"
        onClick={() => (sites.length < 1 || isLoading) ? router.push('/apps') : null}
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
        <PopoverContent 
          align="end" 
          className="w-[300px] p-2"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex flex-col gap-2">
            {sites.map((site) => (
              <AppItem
                key={site.id}
                site={site}
                dataEid={generateClickEID(`${location}.apps_menu.app`)}
              />
            ))}
            { location !== 'homepage' && <AppItemNew location={location} /> }
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}
