import type { NextRequest } from 'next/server';

/**
 * Reads the request body stream up to maxBytes.
 * Returns null when the limit is exceeded so the caller can reject with 413
 * without loading an arbitrarily large payload into memory first.
 */
export async function readBodyCapped(request: NextRequest, maxBytes: number): Promise<string | null> {
  if (!request.body) {
    return '';
  }

  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
    bytesRead += chunk.byteLength;
    if (bytesRead > maxBytes) {
      break;
    }
    chunks.push(chunk);
  }

  if (bytesRead > maxBytes) {
    return null;
  }

  const buffer = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(buffer);
}

/** Parses a JSON string, returning null on invalid input instead of throwing. */
export function parseJsonSafe(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
