/**
 * Conversations export endpoints for an app.
 *
 *   ?format=markdown  - direct streaming proxy of /diagnostics/conversations/export
 *                       (JOMAX). Returns text/markdown so the operator gets the
 *                       file directly without an extra zip wrapper.
 *   ?format=json      - paginates /agent/conversations/:appId, then for each
 *                       page bulk-fetches messages via
 *                       /agent/conversations/:appId/messages and writes one
 *                       json file per conversation into a streaming zip
 *                       archive. A manifest.json with the conversation index
 *                       is added at the end.
 *
 * The JSON archive is streamed via `archiver` -> Web ReadableStream so we
 * never buffer the full export in memory. Client disconnect is wired through
 * to the per-page fetch loop so a cancelled download stops hitting the agents
 * service.
 */

import archiver from 'archiver';
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';

import { fetchAgentJson, streamAgentWithJomax } from '@/lib/agent-client';
import { withAuth } from '@/lib/api-auth';
import { gdAuthService } from '@/lib/gd-auth-service';
import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter, { AgentUrlNotFoundError } from '@/lib/mgmt-control-plane-adapter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const JSON_PAGE_SIZE = 50;
const PAGE_FETCH_TIMEOUT_MS = 30_000;

interface ConversationSummary {
    id: string;
    appId: string;
    agentId: string;
    title: string;
    messageCount?: number;
    createdAt: string;
    updatedAt: string;
}

interface ListPage {
    conversations: ConversationSummary[];
    pagination?: { total?: number; hasMore?: boolean; offset?: number; limit?: number };
}

interface MessagesBatch {
    messages: Array<Record<string, unknown> & { conversationId: string }>;
}

function timestampSlug(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function safeFilename(value: string): string {
    return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

async function fetchListPage(appId: string, limit: number, offset: number, signal: AbortSignal): Promise<ListPage> {
    const { status, body } = await fetchAgentJson({
        appId,
        path: `/agent/conversations/${encodeURIComponent(appId)}`,
        query: { limit: String(limit), offset: String(offset) },
        timeoutMs: PAGE_FETCH_TIMEOUT_MS,
        signal,
    });
    if (status !== 200 || !body || typeof body !== 'object') {
        throw new Error(`Conversation list failed (HTTP ${status})`);
    }
    return body as ListPage;
}

async function fetchMessagesBatch(appId: string, conversationIds: string[], signal: AbortSignal): Promise<MessagesBatch> {
    if (conversationIds.length === 0) return { messages: [] };
    const { status, body } = await fetchAgentJson({
        appId,
        path: `/agent/conversations/${encodeURIComponent(appId)}/messages`,
        query: { conversationIds: conversationIds.join(',') },
        timeoutMs: PAGE_FETCH_TIMEOUT_MS,
        signal,
    });
    if (status !== 200 || !body || typeof body !== 'object') {
        throw new Error(`Messages batch failed (HTTP ${status})`);
    }
    return body as MessagesBatch;
}

async function generateJsonZip(archive: archiver.Archiver, appId: string, signal: AbortSignal): Promise<void> {
    const index: Array<Pick<ConversationSummary, 'id' | 'agentId' | 'title' | 'createdAt' | 'updatedAt' | 'messageCount'>> = [];

    let offset = 0;
    let total: number | undefined;
    while (true) {
        if (signal.aborted) return;
        const page = await fetchListPage(appId, JSON_PAGE_SIZE, offset, signal);
        const list = page.conversations ?? [];
        total = page.pagination?.total ?? total;
        if (list.length === 0) break;

        if (signal.aborted) return;
        const ids = list.map((c) => c.id);
        const { messages } = await fetchMessagesBatch(appId, ids, signal);

        const messagesByConversation = new Map<string, MessagesBatch['messages']>();
        for (const message of messages) {
            const bucket = messagesByConversation.get(message.conversationId) ?? [];
            bucket.push(message);
            messagesByConversation.set(message.conversationId, bucket);
        }

        for (const conversation of list) {
            if (signal.aborted) return;
            const conversationMessages = messagesByConversation.get(conversation.id) ?? [];
            const payload = {
                conversation,
                messages: conversationMessages,
            };
            archive.append(JSON.stringify(payload, null, 2), {
                name: `conversations/${safeFilename(conversation.id)}.json`,
            });
            index.push({
                id: conversation.id,
                agentId: conversation.agentId,
                title: conversation.title,
                createdAt: conversation.createdAt,
                updatedAt: conversation.updatedAt,
                messageCount: conversationMessages.length,
            });
        }

        const fetched = offset + list.length;
        if (page.pagination?.hasMore !== true) break;
        offset = fetched;
    }

    if (signal.aborted) return;
    const manifest = {
        appId,
        format: 'json',
        exportedAt: new Date().toISOString(),
        total: total ?? index.length,
        conversations: index,
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
}

// Header timeout for the upstream markdown export. Body streaming is not
// subject to this; agents may stream a large export over many seconds.
const MARKDOWN_HEADER_TIMEOUT_MS = 60_000;

async function streamMarkdownDirect(
    request: NextRequest,
    appId: string,
    detail: 'summary' | 'full'
): Promise<NextResponse> {
    const jomaxToken = gdAuthService.extractTokenFromRequest(request);
    if (!jomaxToken) {
        return NextResponse.json({ error: 'Missing operator token' }, { status: 401 });
    }
    let upstream;
    try {
        upstream = await streamAgentWithJomax({
            appId,
            path: '/diagnostics/conversations/export',
            query: { appId, detail },
            jomaxToken,
            timeoutMs: MARKDOWN_HEADER_TIMEOUT_MS,
            signal: request.signal,
        });
    } catch (error) {
        if (error instanceof AgentUrlNotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        logger.error('agent.export.markdown.upstream.error', { appId, detail }, { error: error as Error });
        return NextResponse.json({ error: 'Markdown export failed' }, { status: 502 });
    }
    const { status, body, headers } = upstream;
    if (status !== 200 || !body) {
        const text = body ? await new Response(body).text() : '';
        return NextResponse.json(
            { error: text || `Markdown export failed (HTTP ${status})` },
            { status: status === 200 ? 502 : status }
        );
    }
    const filename = `conversations-${safeFilename(appId)}-${timestampSlug()}.md`;
    logger.info('agent.export.markdown.stream.begin', { appId, detail });
    return new NextResponse(body, {
        status: 200,
        headers: {
            'Content-Type': headers.get('content-type') ?? 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
}

export const GET = withAuth<{ appId: string }>(async function exportConversations(request: NextRequest, _auth, context) {
    const { appId } = await context.params;
    if (!APP_ID_RE.test(appId)) {
        return NextResponse.json({ error: 'Invalid appId' }, { status: 400 });
    }

    const url = new URL(request.url);
    const format = url.searchParams.get('format') ?? 'json';
    if (format !== 'json' && format !== 'markdown') {
        return NextResponse.json({ error: 'format must be "json" or "markdown"' }, { status: 400 });
    }

    const detailParam = url.searchParams.get('detail');
    const detail: 'summary' | 'full' = detailParam === 'summary' ? 'summary' : 'full';

    if (format === 'markdown') {
        return streamMarkdownDirect(request, appId, detail);
    }

    // Resolve the agent_url BEFORE we commit HTTP 200 + zip headers. If the
    // app has no agent allocation, return a proper 404 so the client gets a
    // meaningful error code rather than a 200 carrying only an `error.txt`
    // entry inside an otherwise-empty archive.
    try {
        await mgmtControlPlaneAdapter.getAgentUrl(appId);
    } catch (error) {
        if (error instanceof AgentUrlNotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        logger.error('agent.export.resolve.error', { appId }, { error: error as Error });
        return NextResponse.json({ error: 'Failed to resolve agent for app' }, { status: 502 });
    }

    const archive = archiver('zip', { zlib: { level: 6 } });
    const abortController = new AbortController();
    const onClientAbort = () => {
        logger.info('agent.export.stream.client_abort', { appId });
        abortController.abort();
        archive.destroy(new Error('Client disconnected'));
    };
    if (request.signal.aborted) onClientAbort();
    else request.signal.addEventListener('abort', onClientAbort, { once: true });

    archive.on('warning', function onWarning(err) {
        logger.warn('agent.export.archive.warning', { appId, message: err.message });
    });
    archive.on('error', function onError(err) {
        logger.error('agent.export.archive.error', { appId }, { error: err });
    });

    void (async function generate() {
        try {
            await generateJsonZip(archive, appId, abortController.signal);
            await archive.finalize();
        } catch (error) {
            if (abortController.signal.aborted) return;
            if (error instanceof AgentUrlNotFoundError) {
                archive.append(error.message, { name: 'error.txt' });
            } else {
                logger.error('agent.export.generate.error', { appId }, { error: error as Error });
                archive.append(error instanceof Error ? error.message : String(error), { name: 'error.txt' });
            }
            try {
                await archive.finalize();
            } catch (finalizeError) {
                logger.error(
                    'agent.export.finalize.destroy',
                    { appId },
                    { error: finalizeError as Error },
                );
                archive.destroy(finalizeError as Error);
            }
        }
    })();

    const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
    const filename = `conversations-${safeFilename(appId)}-${timestampSlug()}.zip`;

    logger.info('agent.export.stream.begin', { appId, format: 'json', detail });
    return new NextResponse(webStream, {
        status: 200,
        headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
});
