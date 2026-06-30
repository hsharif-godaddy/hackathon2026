'use client';

import { useFetch } from './useFetch';
import type { PdnaTlaFilter } from './usePdnaData';
import type { ScorecardRange } from '../types';

export interface PdnaAppsData {
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
  timeToPublishP50Range: number | null;
  timeToPublishP90Range: number | null;
  appsCreatedDaily: Array<{ date: string; created: number }>;
  appsCreatedDailyByPlan: Array<{ date: string; byPlan: Record<string, number> }>;
  appsDeletedDaily: Array<{ date: string; deleted: number }>;
  everPublishedDaily: Array<{ date: string; everPublished: number }>;
  appsHibernatedDaily: Array<{ date: string; hibernated: number }>;
  appsCustomDomainDaily: Array<{ date: string; customDomain: number }>;
  uniqueCustomersDaily: Array<{ date: string; uniqueCustomers: number }>;
  subscriptionsDaily: Array<{ date: string; subscriptions: number }>;
  subscriptionsDailyByPlan: Array<{ date: string; byPlan: Record<string, number> }>;
  timeToPublishDaily: Array<{ date: string; medianHours: number }>;
  subscriptionPlans: Record<string, number>;
}

export type PdnaAppsResult = { configMissing: true } | PdnaAppsData;

export function usePdnaAppsData(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
  tla: PdnaTlaFilter = 'non-tla',
  plans: string[] = [],
): { data: PdnaAppsResult | null; loading: boolean; stale: boolean; error: string | null } {
  const params = new URLSearchParams({ action: 'pdna-apps', range, tla });
  if (range === 'custom' && customFrom && customTo) {
    params.set('start', customFrom);
    params.set('end', customTo);
  }
  if (plans.length > 0) params.set('plans', plans.join(','));
  const qs = range === 'custom' && (!customFrom || !customTo) ? null : params.toString();
  return useFetch<PdnaAppsResult>(qs);
}
