import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';
import { getLangfuseAnalyticsConfig } from '@/lib/langfuse-analytics-client';
import { getLangfuseConfig } from '@/lib/langfuse-client';

export const GET = withAuth(async (request, _auth) => {
    try {
        const lf = getLangfuseAnalyticsConfig() ?? getLangfuseConfig();
        if (!lf) {
            return NextResponse.json(
                { error: 'Langfuse credentials not configured' },
                { status: 500 }
            );
        }

        const searchParams = request.nextUrl.searchParams;
        const queryParam = searchParams.get('query');

        if (!queryParam) {
            return NextResponse.json(
                { error: 'Missing query parameter' },
                { status: 400 }
            );
        }

        try {
            JSON.parse(queryParam);
        } catch {
            return NextResponse.json(
                { error: 'Invalid JSON in query parameter' },
                { status: 400 }
            );
        }

        const url = `${lf.baseUrl}/api/public/metrics?query=${encodeURIComponent(queryParam)}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': lf.authHeader,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json(
                { error: `Metrics API error: ${response.status} ${response.statusText}`, details: errorText },
                { status: response.status }
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error('Error fetching metrics:', error);
        return NextResponse.json(
            { error: 'Failed to fetch metrics', details: error instanceof Error ? error.message : String(error) },
            { status: 500 }
        );
    }
});
