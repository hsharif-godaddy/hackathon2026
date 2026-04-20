'use client';

import clsx from 'clsx';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Box from '@ux/box';
import AppsIcon from '@ux/icon/apps';
import ChevronDownIcon from '@ux/icon/chevron-down';
import text from '@ux/text';

import AppItem, { AppItemNew, AppItemSeeAll } from '@/components/layout/AppItem';
import { useAuthContext } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/hooks/useTranslations';
import { SiteStatus } from '@/lib/control-plane/types';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/lib/shadcn/popover"
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSites } from '@/stores/useSitesStore';
import { generateClickEID } from '@/utils/instrumentation';

export default function AppSelector({ location }: { location?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const params = useParams();
  const {
    isAuthenticated,
    isLoading: isLoadingAuth
  } = useAuthContext();

  // Only fetch sites once auth state is fully resolved AND user is authenticated.
  // This prevents race conditions where we might try to fetch with an incomplete auth state.
  const {
    sites,
    isLoading: isLoadingSites,
  } = useSites({ enabled: !isLoadingAuth && isAuthenticated })

  const isMobile = useDevelopPageStore((state) => state.isMobile)

  // Auto-expand dropdown on homepage if user has apps
  const [open, setOpen] = useState(false);

  // Open dropdown on homepage once sites are loaded
  useEffect(() => {
    if (location === 'homepage' && !isLoadingSites && sites.length > 0) {
      setOpen(true);
    }
  }, [location, isLoadingSites, sites.length]);

  // Prefetch routes the user is likely to navigate to from this selector.
  // Next.js shares the bundle across all /develop/[id] routes, so one call
  // warms the cache for every app in the list.
  const firstSiteId = sites[0]?.id;
  useEffect(function prefetchSelectorRoutes() {
    if (!isAuthenticated) return;
    router.prefetch('/apps');
    router.prefetch('/');
    if (firstSiteId) {
      router.prefetch(`/develop/${firstSiteId}`);
    }
  }, [router, firstSiteId, isAuthenticated]);

  const isLoading = isLoadingAuth || isLoadingSites;

  // Show nothing while auth is still loading - wait for definitive auth state.
  // Once auth resolves, if not authenticated, show nothing (Header gates this anyway).
  if (isLoadingAuth) {
    return null;
  }

  if (!isAuthenticated) {
    return null;
  }

  // Get current site from URL params
  const currentSiteId = params?.id as string;
  const currentSite = currentSiteId ? sites.find(site => site.id === currentSiteId) : null;
  const displayTitle = currentSite?.name || t('builder_common_my_apps');

  // Sort sites by updated_at (most recent first)
  const sortedSites = [...sites].sort((a, b) => {
    // First priority: running status
    const aIsRunning = a.status === SiteStatus.Running;
    const bIsRunning = b.status === SiteStatus.Running;

    if (aIsRunning && !bIsRunning) return -1;
    if (!aIsRunning && bIsRunning) return 1;

    // Second priority: updated_at (most recent first)
    const dateA = new Date(a.updated_at).getTime();
    const dateB = new Date(b.updated_at).getTime();
    return dateB - dateA;
  });

  // Show only the first 5 sites
  const displayedSites = sortedSites.slice(0, 5);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="hover:cursor-pointer"
        data-eid={generateClickEID(`${location}.apps_menu.trigger`)}
        onClick={() => (sites.length < 1 || isLoading) ? router.push('/apps') : null}
        aria-label={isMobile ? t('builder_common_my_apps') : undefined}
      >
        <Box orientation="horizontal" gap="sm">
          { isMobile ? (
            <AppsIcon className="size-3" />
          ) : (
            <>
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
            </>
          )}
        </Box>
      </PopoverTrigger>
      {sites.length > 0 && (
        <PopoverContent
          align="end"
          className="w-[300px] p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex flex-col gap-1">
            {location !== 'homepage' && <AppItemNew location={location} />}
            {displayedSites.map((site) => (
              <AppItem
                key={site.id}
                site={site}
                dataEid={generateClickEID(`${location}.apps_menu.app`)}
              />
            ))}
            <AppItemSeeAll location={location} />
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}
