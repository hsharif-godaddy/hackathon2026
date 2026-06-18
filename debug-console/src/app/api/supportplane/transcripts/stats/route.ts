import { NextRequest, NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { getL1TranscriptsDb } from '@/lib/l1-transcript-db';

export const GET = withAuth(async (_req: NextRequest) => {
    try {
        const db = getL1TranscriptsDb();

        const total = (db.prepare('SELECT COUNT(*) as n FROM l1_transcripts').get() as { n: number }).n;

        // This week
        const thisWeek = (db.prepare(
            "SELECT COUNT(*) as n FROM l1_transcripts WHERE created_at >= datetime('now', '-7 days')"
        ).get() as { n: number }).n;

        // Last week (for WoW comparison)
        const lastWeek = (db.prepare(
            "SELECT COUNT(*) as n FROM l1_transcripts WHERE created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days')"
        ).get() as { n: number }).n;

        // This month
        const thisMonth = (db.prepare(
            "SELECT COUNT(*) as n FROM l1_transcripts WHERE created_at >= datetime('now', '-30 days')"
        ).get() as { n: number }).n;

        // Last month (for MoM comparison)
        const lastMonth = (db.prepare(
            "SELECT COUNT(*) as n FROM l1_transcripts WHERE created_at >= datetime('now', '-60 days') AND created_at < datetime('now', '-30 days')"
        ).get() as { n: number }).n;

        const dateRange = db.prepare(
            'SELECT MIN(created_at) as from_date, MAX(created_at) as to_date FROM l1_transcripts'
        ).get() as { from_date: string | null; to_date: string | null };

        const topCategories = db.prepare(`
            SELECT category as label, COUNT(*) as count
            FROM l1_transcripts
            WHERE category IS NOT NULL AND category != ''
            GROUP BY category
            ORDER BY count DESC
            LIMIT 8
        `).all() as { label: string; count: number }[];

        const byDay = db.prepare(`
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM l1_transcripts
            WHERE created_at >= datetime('now', '-30 days')
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `).all() as { date: string; count: number }[];

        const avgDurationRow = db.prepare(
            'SELECT AVG(resolution_time_seconds) as avg FROM l1_transcripts WHERE resolution_time_seconds IS NOT NULL'
        ).get() as { avg: number | null };

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
            avgDuration: avgDurationRow.avg ? Math.round(avgDurationRow.avg) : null,
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
