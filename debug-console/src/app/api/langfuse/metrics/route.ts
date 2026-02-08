import { NextResponse } from 'next/server';

import { withAuth } from '@/lib/api-auth';

const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL;
const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

export const GET = withAuth(async (request) => {
    try {
        if (!LANGFUSE_BASE_URL || !LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) {
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

        const authHeader = `Basic ${Buffer.from(`${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}`).toString('base64')}`;

        const url = `${LANGFUSE_BASE_URL}/api/public/metrics?query=${encodeURIComponent(queryParam)}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': authHeader,
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
