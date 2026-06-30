'use client';

import type { ScorecardRange } from '../types';
import type { ScorecardBmpFeedbackData } from './useBmpData';
import { useFetch } from './useFetch';

export interface ScorecardBmpAllData {
  bmp:               ScorecardBmpFeedbackData;
  website:           ScorecardBmpFeedbackData;
  dimEntryPoint:     ScorecardBmpFeedbackData;
  dimPlanType:       ScorecardBmpFeedbackData;
  dimCreationSource: ScorecardBmpFeedbackData;
  dimIntent:         ScorecardBmpFeedbackData;
  paywall:           ScorecardBmpFeedbackData;
}

export function useScorecardBmp(
  range: ScorecardRange,
  customFrom: string,
  customTo: string,
): { data: ScorecardBmpAllData | null; loading: boolean; error: string | null } {
  const params = new URLSearchParams({ action: 'bmp', range });
  if (range === 'custom' && customFrom && customTo) {
    params.set('start', customFrom);
    params.set('end', customTo);
  }
  const qs = range === 'custom' && (!customFrom || !customTo) ? null : params.toString();
  return useFetch<ScorecardBmpAllData>(qs);
}
