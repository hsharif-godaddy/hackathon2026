'use client'

import { useSites } from '@/stores/useSitesStore';
import AppItem, { AppItemSkeleton } from '@/components/layout/AppItem';
import { generateClickEID } from '@/utils/instrumentation';

export default function Apps() {
  const {
    sites,
    isLoading: isLoadingSites,
  } = useSites()

  return (
    <div className="flex grow flex-col overflow-y-auto">
      {isLoadingSites ? (
        <AppItemSkeleton />
      ) : (
        <div className="flex flex-col gap-2 h-full">
          {sites.map((site) => (
            <AppItem
              key={site.id}
              site={site}
              dataEid={generateClickEID('develop.apps.item')} />
          ))}
        </div>
      )}
    </div>
  )
}
