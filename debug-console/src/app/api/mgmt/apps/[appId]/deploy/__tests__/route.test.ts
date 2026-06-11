import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthResult } from '@/lib/api-auth';
import { MgmtControlPlaneError } from '@/lib/mgmt-types';

type RouteHandler = (request: NextRequest, context: unknown) => Promise<NextResponse>;
type AuthHandler = (request: NextRequest, auth: AuthResult, context: unknown) => Promise<NextResponse>;

const mockAuth: AuthResult = {
    authenticated: true,
    user: { shopperId: 'shop-1', cid: 'cid-1', email: 'admin@test.com' },
} as AuthResult;

vi.mock('@/lib/api-auth', () => ({
    withAuth: (handler: AuthHandler) => (request: NextRequest, context: unknown) =>
        handler(request, mockAuth, context),
}));

const deployAppMock = vi.fn();
vi.mock('@/lib/mgmt-control-plane-adapter', () => ({
    default: {
        deployApp: (...args: unknown[]) => deployAppMock(...args),
    },
}));

// Note: @/lib/mgmt-helpers is intentionally NOT mocked — id/variant validation
// and upstream-status passthrough are the route's core logic.

const VALID_APP_ID = 'app12345';
const VALID_SUB_ID = 'sub12345';
const VALID_SYS_ID = 'sys12345';

function makePostRequest(body?: unknown): NextRequest {
    return new NextRequest(`http://localhost/api/mgmt/apps/${VALID_APP_ID}/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
}

function makeContext(appId: string = VALID_APP_ID) {
    return { params: Promise.resolve({ appId }) };
}

const validBody = { subscriptionId: VALID_SUB_ID, systemId: VALID_SYS_ID, variant: 'preview' };

describe('deploy route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        deployAppMock.mockResolvedValue({
            message: 'App composition deployed successfully',
            appId: VALID_APP_ID,
            systemId: VALID_SYS_ID,
            nomadJobIds: ['job-1'],
            variant: 'preview',
        });
    });

    it('returns 400 when variant is missing', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ subscriptionId: VALID_SUB_ID, systemId: VALID_SYS_ID }),
            makeContext()
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('variant must be one of: preview, publish');
        expect(deployAppMock).not.toHaveBeenCalled();
    });

    it('returns 400 when variant is not in the whitelist', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ ...validBody, variant: 'dev' }),
            makeContext()
        );

        expect(response.status).toBe(400);
        expect(deployAppMock).not.toHaveBeenCalled();
    });

    it('returns 400 when subscriptionId is missing', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ systemId: VALID_SYS_ID, variant: 'preview' }),
            makeContext()
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('Invalid subscriptionId');
        expect(deployAppMock).not.toHaveBeenCalled();
    });

    it('returns 400 when subscriptionId is malformed', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ ...validBody, subscriptionId: '!!' }),
            makeContext()
        );

        expect(response.status).toBe(400);
        expect(deployAppMock).not.toHaveBeenCalled();
    });

    it('returns 400 when systemId is missing', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ subscriptionId: VALID_SUB_ID, variant: 'preview' }),
            makeContext()
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe('Invalid systemId');
        expect(deployAppMock).not.toHaveBeenCalled();
    });

    it('returns 400 when body is not valid JSON', async () => {
        const { POST } = await import('../route');
        const request = new NextRequest(`http://localhost/api/mgmt/apps/${VALID_APP_ID}/deploy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json',
        });
        const response = await (POST as RouteHandler)(request, makeContext());

        expect(response.status).toBe(400);
        expect(deployAppMock).not.toHaveBeenCalled();
    });

    it('deploys the preview variant and passes the adapter response through', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(makePostRequest(validBody), makeContext());

        expect(response.status).toBe(200);
        expect(deployAppMock).toHaveBeenCalledWith(VALID_APP_ID, {
            subscriptionId: VALID_SUB_ID,
            systemId: VALID_SYS_ID,
            variant: 'preview',
        });
        const body = await response.json();
        expect(body.nomadJobIds).toEqual(['job-1']);
        expect(body.message).toBe('App composition deployed successfully');
    });

    it('deploys the publish variant', async () => {
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(
            makePostRequest({ ...validBody, variant: 'publish' }),
            makeContext()
        );

        expect(response.status).toBe(200);
        expect(deployAppMock).toHaveBeenCalledWith(VALID_APP_ID, {
            subscriptionId: VALID_SUB_ID,
            systemId: VALID_SYS_ID,
            variant: 'publish',
        });
    });

    it('passes upstream status through when the adapter throws MgmtControlPlaneError', async () => {
        deployAppMock.mockRejectedValue(
            new MgmtControlPlaneError(404, '{"message":"app not found"}', '/api/airo/v1/deploy')
        );
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(makePostRequest(validBody), makeContext());

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error).toBe('app not found');
    });

    it('returns 504 with retry guidance when the upstream call times out', async () => {
        const timeoutError = new Error('The operation was aborted due to timeout');
        timeoutError.name = 'TimeoutError';
        deployAppMock.mockRejectedValue(timeoutError);
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(makePostRequest(validBody), makeContext());

        expect(response.status).toBe(504);
        const body = await response.json();
        expect(body.error).toContain('may still complete');
    });

    it('returns 502 when the adapter throws a generic error', async () => {
        deployAppMock.mockRejectedValue(new Error('socket hang up'));
        const { POST } = await import('../route');
        const response = await (POST as RouteHandler)(makePostRequest(validBody), makeContext());

        expect(response.status).toBe(502);
        const body = await response.json();
        expect(body.error).toBe('Failed to trigger app deploy');
    });
});
