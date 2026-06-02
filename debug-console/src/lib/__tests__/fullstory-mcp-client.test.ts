import { describe, expect, it, vi } from 'vitest';

import {
    callFullstoryMcpTool,
    FullstoryMcpError,
    parseFullstorySessionUrl,
    parseMcpToolResultText,
} from '@/lib/fullstory-mcp-client';

describe('parseFullstorySessionUrl', () => {
    it('parses numeric /session/ URLs including the epoch-ms anchor', () => {
        const parsed = parseFullstorySessionUrl(
            'https://app.fullstory.com/ui/YKBRC/session/1388843285576721830:1562263520177247197:1778483472715',
        );
        expect(parsed).toEqual({
            deviceId: '1388843285576721830',
            sessionId: '1562263520177247197',
            kind: 'numeric',
            anchorEpochMs: 1778483472715,
        });
    });

    it('parses numeric /session/ URLs without an anchor segment', () => {
        const parsed = parseFullstorySessionUrl('https://app.fullstory.com/ui/YKBRC/session/111:222');
        expect(parsed).toEqual({ deviceId: '111', sessionId: '222', kind: 'numeric' });
    });

    it('parses URL-encoded UUID /client-session/ share links and flags them', () => {
        const parsed = parseFullstorySessionUrl(
            'https://app.fullstory.com/ui/YKBRC/client-session/5e943252-1930-4b13-9d46-299c1d7ca5a6%3A53082a41-72a0-4415-bbae-4664f5b753dd%3A1778483472715',
        );
        expect(parsed).toEqual({
            deviceId: '5e943252-1930-4b13-9d46-299c1d7ca5a6',
            sessionId: '53082a41-72a0-4415-bbae-4664f5b753dd',
            kind: 'uuid',
            anchorEpochMs: 1778483472715,
        });
    });

    it('returns null for URLs without a session path segment', () => {
        expect(parseFullstorySessionUrl('https://app.fullstory.com/ui/YKBRC/dashboard')).toBeNull();
    });

    it('returns null for malformed inputs', () => {
        expect(parseFullstorySessionUrl('not a url')).toBeNull();
        expect(parseFullstorySessionUrl('')).toBeNull();
    });
});

describe('parseMcpToolResultText', () => {
    it('preserves BigInt-range device/session ids as strings', () => {
        const raw = '{"sessions":[{"device_id":1388843285576721830,"session_id":1562263520177247197}]}';
        const parsed = parseMcpToolResultText<{ sessions: Array<{ device_id: string; session_id: string }> }>(raw);
        expect(parsed.sessions[0].device_id).toBe('1388843285576721830');
        expect(parsed.sessions[0].session_id).toBe('1562263520177247197');
    });

    it('leaves unrelated fields alone', () => {
        const raw = '{"sessions":[{"device_id":111,"session_id":222,"other":42}]}';
        const parsed = parseMcpToolResultText<{ sessions: Array<Record<string, unknown>> }>(raw);
        expect(parsed.sessions[0].device_id).toBe(111);
        expect(typeof parsed.sessions[0].other).toBe('number');
        expect(parsed.sessions[0].other).toBe(42);
    });

    it('throws FullstoryMcpError with preview when payload is not JSON', () => {
        expect(() => parseMcpToolResultText('<html>not json</html>'))
            .toThrow(/MCP tool returned non-JSON payload.*<html>not json<\/html>/);
    });
});

describe('callFullstoryMcpTool', () => {
    const config = { url: 'https://api.fullstory.test/mcp/fullstory', authHeader: 'Basic key' };

    it('parses plain application/json JSON-RPC responses', async () => {
        const fakeFetch = vi.fn(async function () { return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { content: [{ type: 'text', text: '{"ok":true}' }] },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }); });

        const result = await callFullstoryMcpTool<{ ok: boolean }>(config, 'noop', {}, { fetchImpl: fakeFetch });
        expect(result).toEqual({ ok: true });
        expect(fakeFetch).toHaveBeenCalledTimes(1);
    });

    it('parses text/event-stream responses with a single data: frame', async () => {
        const sseBody = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\\"ok\\":1}"}]}}\n\n';
        const fakeFetch = vi.fn(async function () { return new Response(sseBody, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
        }); });

        const result = await callFullstoryMcpTool<{ ok: number }>(config, 'noop', {}, { fetchImpl: fakeFetch });
        expect(result).toEqual({ ok: 1 });
    });

    it('raises FullstoryMcpError when the server returns a JSON-RPC error', async () => {
        const fakeFetch = vi.fn(async function () { return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            error: { code: -32601, message: 'method not found' },
        }), { status: 200 }); });

        await expect(callFullstoryMcpTool(config, 'noop', {}, { fetchImpl: fakeFetch }))
            .rejects.toThrow(FullstoryMcpError);
    });

    it('raises FullstoryMcpError with preview when the JSON-RPC frame is malformed', async () => {
        const truncated = '{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"{';
        const fakeFetch = vi.fn(async function () { return new Response(truncated, { status: 200 }); });
        await expect(callFullstoryMcpTool(config, 'noop', {}, { fetchImpl: fakeFetch }))
            .rejects.toThrow(/MCP transport returned malformed JSON-RPC.*preview=/);
    });

    it('raises FullstoryMcpError on HTTP failure', async () => {
        const fakeFetch = vi.fn(async function () { return new Response('nope', { status: 403 }); });
        await expect(callFullstoryMcpTool(config, 'noop', {}, { fetchImpl: fakeFetch }))
            .rejects.toThrow(/MCP HTTP 403/);
    });
});
