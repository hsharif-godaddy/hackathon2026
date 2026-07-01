import { NextRequest, NextResponse } from 'next/server';

import { CORS_ROUTES, createCorsOptionsHandler } from '@/lib/cors';
import { CustomerAuthContext, withCustomerAuth } from '@/lib/customer-auth';

function buildHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script src="/scripts/receive-bridge.js"></script>
{"status": "up", "timestamp": "${new Date().toISOString()}"}
</body>
</html>`;
}

export const OPTIONS = createCorsOptionsHandler(CORS_ROUTES.GET_RECEIVE);

export const GET = withCustomerAuth(
  async (request: NextRequest, _authContext: CustomerAuthContext): Promise<NextResponse> => {
    return new NextResponse(buildHtml(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  },
  { addCorsHeaders: true, corsRoute: CORS_ROUTES.GET_RECEIVE }
);
