'use client';

import { useFetch } from './useFetch';
import type { ScorecardRange } from '../types';

export interface PdnaUnitsByPlan {
  starter: number;
  professional: number;
  ultimate: number;
}

export interface PdnaDailyPoint {
  date: string;
  total: number;
  byPlan: PdnaUnitsByPlan;
}

export interface ScorecardPdnaData {
  configMissing: boolean;
  paidUnitsDaily: PdnaDailyPoint[];
  paidUnitsToday: number;
  paidUnitsInRange: number;
  purchaseStarter: number;
  purchasePro: number;
  purchaseUltimate: number;
}

export type PdnaTlaFilter = 'non-tla' | 'tla' | 'all';

export function usePdnaData(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
  tla: PdnaTlaFilter = 'non-tla',
): { data: ScorecardPdnaData | null; loading: boolean; error: string | null } {
  const params = new URLSearchParams({ action: 'pdna', range, tla });
  if (range === 'custom' && customFrom && customTo) { params.set('start', customFrom); params.set('end', customTo); }
  const qs = range === 'custom' && (!customFrom || !customTo) ? null : params.toString();
  return useFetch<ScorecardPdnaData>(qs);
}
