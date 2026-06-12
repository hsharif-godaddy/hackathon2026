import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { parseJsonSafe, readBodyCapped } from './utils';

function makeRequest(body: BodyInit | null): NextRequest {
  return new NextRequest('http://localhost/test', { method: 'POST', body });
}

function makeStreamRequest(chunks: string[]): NextRequest {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
  return new NextRequest('http://localhost/test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
}

describe('scan utils', () => {
  describe('readBodyCapped', () => {
    it('returns empty string when body is null', async () => {
      const request = makeRequest(null);
      expect(await readBodyCapped(request, 100)).toBe('');
    });

    it('returns the body string when within the limit', async () => {
      const request = makeRequest('hello');
      expect(await readBodyCapped(request, 100)).toBe('hello');
    });

    it('returns null when body exceeds the limit by one byte', async () => {
      const body = 'x'.repeat(11);
      const request = makeRequest(body);
      expect(await readBodyCapped(request, 10)).toBeNull();
    });

    it('returns the body when exactly at the limit', async () => {
      const body = 'x'.repeat(10);
      const request = makeRequest(body);
      expect(await readBodyCapped(request, 10)).toBe(body);
    });

    it('reassembles a multi-chunk stream within the limit', async () => {
      const request = makeStreamRequest(['hel', 'lo', ' world']);
      expect(await readBodyCapped(request, 100)).toBe('hello world');
    });

    it('returns null when the limit is exceeded mid-stream', async () => {
      const request = makeStreamRequest(['aaaaa', 'bbbbb', 'ccccc']);
      expect(await readBodyCapped(request, 12)).toBeNull();
    });
  });

  describe('parseJsonSafe', () => {
    it('parses a valid JSON object', () => {
      expect(parseJsonSafe('{"a":1}')).toEqual({ a: 1 });
    });

    it('parses a valid JSON array', () => {
      expect(parseJsonSafe('[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('parses a JSON primitive', () => {
      expect(parseJsonSafe('"hello"')).toBe('hello');
      expect(parseJsonSafe('42')).toBe(42);
      expect(parseJsonSafe('true')).toBe(true);
    });

    it('returns null for invalid JSON', () => {
      expect(parseJsonSafe('not json')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(parseJsonSafe('')).toBeNull();
    });

    it('returns null for truncated JSON', () => {
      expect(parseJsonSafe('{"a":')).toBeNull();
    });
  });
});
