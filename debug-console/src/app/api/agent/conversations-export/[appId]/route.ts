/**
 * Conversations export endpoints for an app.
 *
 *   ?format=markdown - paginates /agent/conversations/:appId then for each
 *                       conversation pages messages via /agent/conversations/:appId/:cid?limit=…&before=…
 *                       and writes the markdown body straight to the response.
 *   ?format=json     - same pagination, but writes one JSON file per conversation
 *                       into a streaming zip archive plus a manifest.json.
 *
 * Both formats are streamed: agents service never holds an entire app in
 * memory, and debug-console buffers at most one conversation's messages
 * at a time before writing.
 */

import archiver from 'archiver';
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';

import { fetchAgentJson } from '@/lib/agent-client';
import { withAuth } from '@/lib/api-auth';
import {
    formatConversationMarkdown,
    formatExportFooter,
    formatExportHeader,
    type Conversation,
    type ConversationMessage,
    type ExportDetail,
} from '@/lib/conversation-markdown';
import { logger } from '@/lib/logger';
import mgmtControlPlaneAdapter, { AgentUrlNotFoundError } from '@/lib/mgmt-control-plane-adapter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const APP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const LIST_PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 200;
const PAGE_FETCH_TIMEOUT_MS = 30_000;
// Hard cap on detail pages per conversation. At 200 messages/page this allows
// up to 1M messages, which exceeds any realistic conversation. Guards against
// a buggy `hasMore=true` upstream that would otherwise loop forever.
const MAX_DETAIL_PAGES = 5_000;

interface ListPage {
    conversations: Conversation[];
    pagination?: { total?: number; hasMore?: boolean; offset?: number; limit?: number };
}

interface DetailPage {
    conversation: Conversation;
    messages: ConversationMessage[];
    pagination: { total: number; hasMore: boolean; nextCursor: string | null };
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

async function fetchDetailPage(
    appId: string,
    conversationId: string,
    cursor: string | undefined,
    signal: AbortSignal,
): Promise<DetailPage> {
    const { status, body } = await fetchAgentJson({
        appId,
        path: `/agent/conversations/${encodeURIComponent(appId)}/${encodeURIComponent(conversationId)}`,
        query: {
            limit: String(MESSAGE_PAGE_SIZE),
            ...(cursor ? { before: cursor } : {}),
        },
        timeoutMs: PAGE_FETCH_TIMEOUT_MS,
        signal,
    });
    if (status !== 200 || !body || typeof body !== 'object') {
        throw new Error(`Conversation detail failed (HTTP ${status})`);
    }
    // Legacy shim: the previous agents service ignores limit/before and
    // returns { conversation, messages } with no pagination field. Treat
    // that as a single full page so the export pipeline terminates after
    // one round trip. Remove once agents has rolled out.
    const detail = body as Partial<DetailPage> & { messages: ConversationMessage[]; conversation: Conversation };
    if (!detail.pagination) {
        detail.pagination = { total: detail.messages.length, hasMore: false, nextCursor: null };
    }
    return detail as DetailPage;
}

async function collectAllMessages(
    appId: string,
    conversationId: string,
    signal: AbortSignal,
): Promise<ConversationMessage[]> {
    // Each page is chronological internally; subsequent pages reach further
    // back via `before=cursor`. Collect into an array of arrays and reverse
    // before flattening — O(n) total, vs. unshift-per-page which is O(n²)
    // and noticeable on multi-thousand-message conversations.
    const pages: ConversationMessage[][] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    do {
        if (signal.aborted) break;
        if (pageCount >= MAX_DETAIL_PAGES) {
            logger.warn('agent.export.detail.page_cap', { appId, conversationId, pageCount });
            break;
        }
        const page = await fetchDetailPage(appId, conversationId, cursor, signal);
        pages.push(page.messages);
        pageCount += 1;
        cursor = page.pagination.hasMore && page.pagination.nextCursor ? page.pagination.nextCursor : undefined;
    } while (cursor && !signal.aborted);
    return pages.reverse().flat();
}

interface JsonSink {
    kind: 'json';
    archive: archiver.Archiver;
    index: Array<{
        id: string;
        agentId: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        messageCount: number;
    }>;
}

interface MarkdownSink {
    kind: 'markdown';
    write: (chunk: string) => void;
}

type ExportSink = JsonSink | MarkdownSink;

async function generateExport(
    appId: string,
    detail: ExportDetail,
    signal: AbortSignal,
    sink: ExportSink,
): Promise<void> {
    if (sink.kind === 'markdown') sink.write(formatExportHeader(appId));

    let offset = 0;
    let total: number | undefined;
    while (true) {
        if (signal.aborted) return;
        const page = await fetchListPage(appId, LIST_PAGE_SIZE, offset, signal);
        const list = page.conversations ?? [];
        total = page.pagination?.total ?? total;
        if (list.length === 0) break;

        for (const conversation of list) {
            if (signal.aborted) return;
            const messages = await collectAllMessages(appId, conversation.id, signal);
            if (sink.kind === 'json') {
                sink.archive.append(
                    JSON.stringify({ conversation, messages }, null, 2),
                    { name: `conversations/${safeFilename(conversation.id)}.json` },
                );
                sink.index.push({
                    id: conversation.id,
                    agentId: conversation.agentId,
                    title: conversation.title,
                    createdAt: conversation.createdAt,
                    updatedAt: conversation.updatedAt,
                    messageCount: messages.length,
                });
            } else {
                sink.write(formatConversationMarkdown(conversation, messages, detail));
            }
        }

        if (page.pagination?.hasMore !== true) break;
        offset += list.length;
    }

    if (sink.kind === 'markdown') {
        sink.write(formatExportFooter());
    } else {
        const manifest = {
            appId,
            format: 'json',
            exportedAt: new Date().toISOString(),
            total: total ?? sink.index.length,
            conversations: sink.index,
        };
        sink.archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    }
}

async function streamMarkdown(
    request: NextRequest,
    appId: string,
    detail: ExportDetail,
): Promise<NextResponse> {
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const encoder = new TextEncoder();
            const sink: MarkdownSink = {
                kind: 'markdown',
                write: (chunk) => controller.enqueue(encoder.encode(chunk)),
            };
            const abortController = new AbortController();
            const onAbort = () => abortController.abort();
            if (request.signal.aborted) onAbort();
            else request.signal.addEventListener('abort', onAbort, { once: true });
            try {
                await generateExport(appId, detail, abortController.signal, sink);
                controller.close();
            } catch (error) {
                if (abortController.signal.aborted) {
                    controller.close();
                    return;
                }
                logger.error('agent.export.markdown.error', { appId }, { error: error as Error });
                try {
                    controller.enqueue(encoder.encode(`\n<!-- export error: ${error instanceof Error ? error.message : String(error)} -->\n`));
                } catch { /* controller already closed */ }
                controller.close();
            } finally {
                request.signal.removeEventListener('abort', onAbort);
            }
        },
    });

    const filename = `conversations-${safeFilename(appId)}-${timestampSlug()}.md`;
    logger.info('agent.export.markdown.stream.begin', { appId, detail });
    return new NextResponse(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-store',
        },
    });
}

async function streamJsonZip(
    request: NextRequest,
    appId: string,
    detail: ExportDetail,
): Promise<NextResponse> {
    const archive = archiver('zip', { zlib: { level: 6 } });
    const abortController = new AbortController();
    const onClientAbort = () => {
        logger.info('agent.export.json.client_abort', { appId });
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

    const sink: JsonSink = { kind: 'json', archive, index: [] };

    void (async function generate() {
        try {
            await generateExport(appId, detail, abortController.signal, sink);
            await archive.finalize();
        } catch (error) {
            if (abortController.signal.aborted) return;
            logger.error('agent.export.json.error', { appId }, { error: error as Error });
            archive.append(error instanceof Error ? error.message : String(error), { name: 'error.txt' });
            try {
                await archive.finalize();
            } catch (finalizeError) {
                logger.error('agent.export.finalize.destroy', { appId }, { error: finalizeError as Error });
                archive.destroy(finalizeError as Error);
            }
        }
    })();

    const webStream = Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
    const filename = `conversations-${safeFilename(appId)}-${timestampSlug()}.zip`;
    logger.info('agent.export.json.stream.begin', { appId, detail });
    return new NextResponse(webStream, {
        status: 200,
        headers: {
            'Content-Type': 'application/zip',
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
    const detail: ExportDetail = detailParam === 'summary' ? 'summary' : 'full';

    // Resolve the agent_url before committing 200 + streaming headers so
    // missing agent allocations surface as a real 404.
    try {
        await mgmtControlPlaneAdapter.getAgentUrl(appId);
    } catch (error) {
        if (error instanceof AgentUrlNotFoundError) {
            return NextResponse.json({ error: error.message }, { status: 404 });
        }
        logger.error('agent.export.resolve.error', { appId }, { error: error as Error });
        return NextResponse.json({ error: 'Failed to resolve agent for app' }, { status: 502 });
    }

    if (format === 'markdown') return streamMarkdown(request, appId, detail);
    return streamJsonZip(request, appId, detail);
});
