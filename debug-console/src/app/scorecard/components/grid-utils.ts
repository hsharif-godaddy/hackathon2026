// Shared layout helpers for scorecard tab files.
import type { CSSProperties } from 'react';

import type { ScorecardChartSize } from '../types';

export const CARD: CSSProperties = {
  backgroundColor: 'var(--sp-s1)',
  border: '1px solid var(--sp-border)',
  borderRadius: '10px',
  padding: '0.6rem 0.85rem',
};

// Standard metric card grid (most tabs).
export function cardGrid(size: ScorecardChartSize): string {
  return size === 'full'  ? 'repeat(auto-fit, minmax(195px, 1fr))'
       : size === 'large' ? 'repeat(auto-fit, minmax(170px, 1fr))'
       : 'repeat(auto-fit, minmax(135px, 1fr))';
}

// Standard chart/trend grid.
export function chartGrid(size: ScorecardChartSize): string {
  return size === 'full'  ? '1fr'
       : size === 'large' ? 'repeat(2, 1fr)'
       : 'repeat(auto-fit, minmax(240px, 1fr))';
}
