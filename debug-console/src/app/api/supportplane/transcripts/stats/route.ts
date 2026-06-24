import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getAllTranscriptsCached } from '@/lib/supportplane/db/transcript-cache';
import type { TranscriptRow } from '@/lib/supportplane/db/l1-transcript-db';

export const GET = withAuth(async (_req: NextRequest) => {
    try {
        const all: TranscriptRow[] = await getAllTranscriptsCached();
        const nowMs = Date.now();
        const days7Ms = 7 * 24 * 60 * 60 * 1000;
        const days14Ms = 14 * 24 * 60 * 60 * 1000;
        const days30Ms = 30 * 24 * 60 * 60 * 1000;
        const days60Ms = 60 * 24 * 60 * 60 * 1000;

        const timestamps = all
          .map((row) => (row.created_at ? new Date(row.created_at).getTime() : Number.NaN))
          .filter((value) => Number.isFinite(value));

        const total = all.length;
        const thisWeek = timestamps.filter((value) => value >= nowMs - days7Ms).length;
        const lastWeek = timestamps.filter(
          (value) => value >= nowMs - days14Ms && value < nowMs - days7Ms
        ).length;
        const thisMonth = timestamps.filter((value) => value >= nowMs - days30Ms).length;
        const lastMonth = timestamps.filter(
          (value) => value >= nowMs - days60Ms && value < nowMs - days30Ms
        ).length;

        const createdAts = all
          .map((row) => row.created_at)
          .filter((value): value is string => Boolean(value))
          .sort((left, right) => left.localeCompare(right));
        const dateRange = {
          from_date: createdAts.length ? createdAts[0] : null,
          to_date: createdAts.length ? createdAts[createdAts.length - 1] : null,
        };

        const categoryMap = new Map<string, number>();
        const byDayMap = new Map<string, number>();
        let durationTotal = 0;
        let durationCount = 0;

        for (const row of all) {
          if (row.category) {
            categoryMap.set(row.category, (categoryMap.get(row.category) || 0) + 1);
          }
          if (row.created_at) {
            const createdMs = new Date(row.created_at).getTime();
            if (createdMs >= nowMs - days30Ms) {
              const day = row.created_at.slice(0, 10);
              byDayMap.set(day, (byDayMap.get(day) || 0) + 1);
            }
          }
          if (typeof row.resolution_time_seconds === 'number') {
            durationTotal += row.resolution_time_seconds;
            durationCount += 1;
          }
        }

        const topCategories = [...categoryMap.entries()]
          .map(([label, count]) => ({ count, label }))
          .sort((left, right) => right.count - left.count)
          .slice(0, 8);

        const byDay = [...byDayMap.entries()]
          .map(([date, count]) => ({ count, date }))
          .sort((left, right) => left.date.localeCompare(right.date));

        // Calculate deltas
        const weekDelta = thisWeek - lastWeek;
        const monthDelta = thisMonth - lastMonth;
        const weekDeltaPct = lastWeek > 0 ? Math.round((weekDelta / lastWeek) * 100) : 0;
        const monthDeltaPct = lastMonth > 0 ? Math.round((monthDelta / lastMonth) * 100) : 0;

        return NextResponse.json({
            total,
            thisWeek,
            lastWeek,
            weekDelta,
            weekDeltaPct,
            thisMonth,
            lastMonth,
            monthDelta,
            monthDeltaPct,
            avgDuration: durationCount > 0 ? Math.round(durationTotal / durationCount) : null,
            dateRange: { from: dateRange.from_date, to: dateRange.to_date },
            topCategories,
            byDay,
        });
    } catch (err) {
        logger.error('supportplane.transcripts.stats.error', { error: String(err) });
        return NextResponse.json({
            total: 0, thisWeek: 0, lastWeek: 0, weekDelta: 0, weekDeltaPct: 0,
            thisMonth: 0, lastMonth: 0, monthDelta: 0, monthDeltaPct: 0,
            avgDuration: null, dateRange: { from: null, to: null },
            topCategories: [], byDay: [],
        });
    }
});
