'use client';

import { useFetch } from './useFetch';

export interface DatasourceStatus {
  pdna:      { configured: boolean };
  s3:        { configured: boolean };
  loki:      { configured: boolean };
  bmp:       { configured: boolean };
  fullstory: { configured: boolean };
  c1:        { configured: boolean };
}

const FALLBACK: DatasourceStatus = {
  pdna:      { configured: false },
  s3:        { configured: false },
  loki:      { configured: false },
  bmp:       { configured: false },
  fullstory: { configured: false },
  c1:        { configured: false },
};

export function useDatasourceStatus(): DatasourceStatus | null {
  const { data } = useFetch<DatasourceStatus>('action=datasource-status');
  return data ?? FALLBACK;
}
