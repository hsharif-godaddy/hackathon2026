'use client';

import { useFetch } from './useFetch';

export interface PdnaAppsSnapshotData {
  configMissing: false;
  snapshotDate: string;
  totalApps: number;
  publishedCount: number;
  publishRate: number;
  everPublishedCount: number;
  everPublishedRate: number;
  hibernatedCount: number;
  hibernationRate: number;
  deletedCount: number;
  totalSubscriptions: number;
  customDomainCount: number;
  customDomainRate: number;
  downgradesCount: number;
  timeToPublishP50: number | null;
  timeToPublishP90: number | null;
}

export type PdnaAppsSnapshotResult = { configMissing: true } | PdnaAppsSnapshotData;

export function usePdnaAppsSnapshot(): { data: PdnaAppsSnapshotResult | null; loading: boolean; error: string | null } {
  const { data, loading, error } = useFetch<PdnaAppsSnapshotResult>('action=pdna-apps-snapshot');
  return { data, loading, error };
}
