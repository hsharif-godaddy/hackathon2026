import { NextRequest, NextResponse } from 'next/server';

import { streamAgentResponse } from '@/lib/agent-client';
import { withAuth } from '@/lib/api-auth';
import { logger } from '@/lib/logger';
import { AgentUrlNotFoundError } from '@/lib/mgmt-control-plane-adapter';

export const dynamic = 'force-dynamic';

const APP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function passthroughHeader(headers: Headers, name: string): string | undefined {
    const value = headers.get(name);
    return value ?? undefined;
}

// Header timeout for the upstream zip request: agents may need to assemble
// the archive on disk before responding, so allow up to 60s before headers.
// The body stream itself is not subject to this timeout.
const ZIP_HEADER_TIMEOUT_MS = 60_000;

export const GET = withAuth<{ appId: string }>(async function getZip(request: NextRequest, _auth, context) {
    const { appId } = await context.params;
    if (!APP_ID_RE.test(appId)) {
        return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
    }

    try {
        const { status, body, headers } = await streamAgentResponse({
            appId,
            path: `/apps/${encodeURIComponent(appId)}/zip`,
            query: { nameStyle: 'appId' },
            canDownload: true,
            timeoutMs: ZIP_HEADER_TIMEOUT_MS,
            signal: request.signal,
        });

        if (status !== 200 || !body) {
            // On non-200 the agent returns JSON error - read it and pass through.
            const text = body ? await new Response(body).text() : '';
            const parsed = (() => {
                if (!text) return null;
                try {
                    return JSON.parse(text);
                } catch {
                    return null;
                }
            })();
            const message = (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string')
                ? parsed.error
                : `Agent returned ${status}`;
            logger.warn('agent.zip.upstream-error', { appId, status, message });
            return NextResponse.json({ error: message }, { status });
        }

        const responseHeaders: Record<string, string> = {
            'Content-Type': passthroughHeader(headers, 'content-type') ?? 'application/zip',
            'Content-Disposition': passthroughHeader(headers, 'content-disposition')
                ?? `attachment; filename="${appId}.zip"`,
            'Cache-Control': 'no-store',
        };
        const contentLength = passthroughHeader(headers, 'content-length');
        if (contentLength) responseHeaders['Content-Length'] = contentLength;

        logger.info('agent.zip.stream.begin', { appId });
        return new NextResponse(body, { status, headers: responseHeaders });
    } catch (error) {
        if (error instanceof AgentUrlNotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        logger.error('agent.zip.error', { appId }, { error: error as Error });
        return NextResponse.json({ error: 'Failed to download app zip' }, { status: 502 });
    }
});
