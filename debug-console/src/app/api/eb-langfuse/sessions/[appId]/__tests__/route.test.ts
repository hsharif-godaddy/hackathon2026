import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mocks (must be set up before importing the route) ─────────────────────

vi.mock('@/lib/api-auth', () => ({
    withAuth: <P,>(
        handler: (request: NextRequest, auth: { authenticated: true }, context: P) => Promise<Response>,
    ) =>
        async (request: NextRequest, context: P): Promise<Response> =>
            handler(request, { authenticated: true }, context),
}));

const resolveCustomerIdMock = vi.fn();
vi.mock('@/lib/langfuse-eb-client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/langfuse-eb-client')>();
    return {
        ...actual, // keep the real buildAppIdFilter
        getLangfuseEbConfig: () => ({ baseUrl: 'https://eb.test', authHeader: 'Basic x' }),
        resolveCustomerId: (...args: unknown[]) => resolveCustomerIdMock(...args),
    };
});

vi.mock('@/lib/bms-credit-ratio', () => ({
    NOT_BMS_RATIO: { useBms: false, ratio: null, mixedRatios: false },
    resolveCreditRatio: vi.fn().mockResolvedValue({ useBms: false, ratio: null, mixedRatios: false }),
}));

type Ctx = { params: Promise<{ appId: string }> };
type GetHandler = (request: NextRequest, context: Ctx) => Promise<Response>;
let GET: GetHandler;

const APP_ID = 'app123456';

function makeRequest(query = 'page=1'): NextRequest {
    return new NextRequest(`https://local.test/api/eb-langfuse/sessions/${APP_ID}?${query}`);
}
function ctx(appId = APP_ID): Ctx {
    return { params: Promise.resolve({ appId }) };
}
function jsonResponse(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
        body: null,
    } as unknown as Response;
}

describe('GET /api/eb-langfuse/sessions/[appId]', () => {
    beforeEach(async () => {
        resolveCustomerIdMock.mockReset();
        const mod = await import('../route');
        GET = mod.GET as unknown as GetHandler;
    });

    afterEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
    });

    it('returns 502 when the customerId cannot be resolved', async () => {
        resolveCustomerIdMock.mockResolvedValue(null);
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        const res = await GET(makeRequest(), ctx());

        expect(res.status).toBe(502);
        // Must not have queried Langfuse without a customer scope.
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('pairs the indexed userId=customerId with the appId metadata filter on the list query', async () => {
        resolveCustomerIdMock.mockResolvedValue('cust-1');
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('/api/public/traces/')) {
                // per-trace detail fetch
                return Promise.resolve(
                    jsonResponse({ id: 't1', timestamp: '2026-01-01T00:00:00Z', sessionId: 's1', tags: [], observations: [], totalCost: 0 }),
                );
            }
            // list fetch
            return Promise.resolve(jsonResponse({ data: [{ id: 't1' }], meta: { totalPages: 1, totalItems: 1 } }));
        });

        const res = await GET(makeRequest(), ctx());
        expect(res.status).toBe(200);

        const listUrl = fetchSpy.mock.calls
            .map((c) => (typeof c[0] === 'string' ? c[0] : String(c[0])))
            .find((u) => u.includes('/api/public/traces?'));
        expect(listUrl).toBeDefined();
        const params = new URL(listUrl!).searchParams;
        expect(params.get('userId')).toBe('cust-1');
        // filter carries the appId metadata predicate
        expect(params.get('filter')).toContain('business_data_appId');
        expect(params.get('filter')).toContain(APP_ID);
    });
});
