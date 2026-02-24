/**
 * Domain Config API Route
 *
 * Returns domain purchase configuration required by client-side components.
 * Keeps the API key name server-side instead of exposing via NEXT_PUBLIC_ env var.
 */

import { NextResponse } from 'next/server';

import { withCustomerAuth } from '@/lib/customer-auth';

export const dynamic = 'force-dynamic';

export const GET = withCustomerAuth(async () => {
  return NextResponse.json({
    apiKeyName: process.env.DOMAIN_FIND_API_KEY || '',
  });
});
