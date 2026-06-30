'use client';

import type { ScorecardLokiData } from '@/lib/analytics/scorecard/loki';

import { useFetch } from './useFetch';
import type { ScorecardRange } from '../types';

export function useLokiData(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
): { data: ScorecardLokiData | null; loading: boolean; error: string | null } {
  const params = new URLSearchParams({ action: 'loki', range });
  if (range === 'custom' && customFrom && customTo) { params.set('start', customFrom); params.set('end', customTo); }
  const qs = range === 'custom' && (!customFrom || !customTo) ? null : params.toString();
  return useFetch<ScorecardLokiData>(qs);
}
