'use client'

import { useSites } from '@/stores/useSitesStore';
import SiteItem, { SiteItemSkeleton } from '@/components/layout/SiteItem';
import { generateClickEID } from '@/utils/instrumentation';

export default function Apps() {
  const {
    sites,
    isLoading: isLoadingSites,
  } = useSites()

  return (
    <div className="flex grow flex-col overflow-y-auto">
      {isLoadingSites ? (
        <SiteItemSkeleton />
      ) : (
        <div className="flex flex-col gap-2 h-full">
          {sites.map((site) => (
            <SiteItem
              key={site.id}
              site={site}
              dataEid={generateClickEID('develop.apps.item')} />
          ))}
        </div>
      )}
    </div>
  )
}
