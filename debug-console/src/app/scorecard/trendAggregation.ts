import type { IntervalDataPoint } from './components';
import type { TrendView } from './types';

export function getBucketKey(fullDate: string, view: TrendView): string {
  if (view === 'daily') return fullDate;
  const d = new Date(`${fullDate}T00:00:00Z`);
  if (view === 'weekly') {
    const day = d.getUTCDay();
    const daysToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(d.getTime() + daysToMon * 86_400_000);
    return mon.toISOString().slice(0, 10);
  }
  if (view === 'monthly') return fullDate.slice(0, 7);
  return fullDate.slice(0, 4);
}

export function formatBucketLabel(bucketKey: string, view: TrendView): string {
  if (view === 'daily') return bucketKey.slice(5);
  if (view === 'weekly') {
    const d = new Date(`${bucketKey}T00:00:00Z`);
    return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
  }
  if (view === 'monthly') {
    const parts = bucketKey.split('-') as [string, string];
    const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 1));
    return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} '${parts[0].slice(2)}`;
  }
  return bucketKey;
}

export function aggregateByView(
  points: IntervalDataPoint[],
  seriesKeys: string[],
  view: TrendView,
): IntervalDataPoint[] {
  if (view === 'daily') return points;
  const buckets = new Map<string, Map<string, number>>();
  for (const pt of points) {
    const fullDate = (pt._date as string | undefined) ?? String(pt.label);
    const bucketKey = getBucketKey(fullDate, view);
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, new Map());
    const row = buckets.get(bucketKey)!;
    for (const k of seriesKeys) {
      row.set(k, (row.get(k) ?? 0) + (Number(pt[k]) || 0));
    }
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucketKey, row]): IntervalDataPoint => {
      const pt: IntervalDataPoint = { label: formatBucketLabel(bucketKey, view) };
      for (const k of seriesKeys) pt[k] = row.get(k) ?? 0;
      return pt;
    });
}

export function viewLabel(view: TrendView): string {
  if (view === 'weekly')  return 'week-wise';
  if (view === 'monthly') return 'month-wise';
  if (view === 'yearly')  return 'year-wise';
  return 'day-wise';
}
