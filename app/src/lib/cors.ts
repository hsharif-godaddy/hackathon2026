import { NextRequest, NextResponse } from 'next/server';

type AllowedOrigin = { origins: Set<string>; methods: string };

/**
 * Routes that support CORS
 */
export const CORS_ROUTES = Object.freeze({
  GET_SITES: 'GET_SITES',
  GET_SUBSCRIPTIONS: 'GET_SUBSCRIPTIONS',
  QUICK_CREATE: 'QUICK_CREATE',
  GET_SWITCHBOARD: 'GET_SWITCHBOARD'
} as const)

const aiPromptLibOrigins = new Set([
  'https://www.dev-godaddy.com',
  'https://www.test-godaddy.com',
  'https://www.godaddy.com',
  'https://start.dev-godaddy.com',
  'https://start.test-godaddy.com',
  'https://start.dev-godaddy.com:8443',
  'https://start.test-godaddy.com:8443',
  'https://start.godaddy.com',
  'https://dashboard.dev-godaddy.com',
  'https://dashboard.test-godaddy.com',
  'https://dashboard.godaddy.com',
]);

const myaOrigins = new Set([
  'https://account.test-godaddy.com',
  'https://account.godaddy.com',
  'https://local.cx.test-godaddy.com:8443',
  'https://local.cx.godaddy.com:8443',
]);

const ALLOWED_ORIGINS_MAP: Record<keyof typeof CORS_ROUTES, AllowedOrigin> = {
  [CORS_ROUTES.GET_SITES]: {
    origins: myaOrigins,
    methods: 'GET, OPTIONS'
  },
  [CORS_ROUTES.GET_SUBSCRIPTIONS]: {
    origins: myaOrigins,
    methods: 'GET, OPTIONS'
  },
  [CORS_ROUTES.QUICK_CREATE]: {
    origins: aiPromptLibOrigins,
    methods: 'POST, OPTIONS'
  },
  [CORS_ROUTES.GET_SWITCHBOARD]: {
    origins: aiPromptLibOrigins,
    methods: 'GET, OPTIONS'
  }
};

/**
 * Add CORS headers to response if origin is allowed
 */
export function withCorsHeaders(response: NextResponse, origin: string | null, route: keyof typeof CORS_ROUTES): NextResponse {
  const allowedOrigin = ALLOWED_ORIGINS_MAP[route];

  if (origin && allowedOrigin && allowedOrigin.origins.has(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', allowedOrigin.methods);
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Vary', 'Origin');
  }
  return response;
}

/**
 * Create OPTIONS handler for CORS preflight requests
 */
export function createCorsOptionsHandler(route: keyof typeof CORS_ROUTES) {
  return async function OPTIONS(request: NextRequest): Promise<NextResponse> {
    const origin = request.headers.get('origin');
    const response = new NextResponse(null, { status: 204 });
    return withCorsHeaders(response, origin, route);
  };
}
