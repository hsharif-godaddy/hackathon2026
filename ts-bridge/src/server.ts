import http from 'http';
import fs from 'fs';
import { URL } from 'url';
import { getToolDescriptors } from './tool-registry.js';
import { executeTool, type BridgeContext } from './executor.js';

const socketPath = process.env['TS_BRIDGE_SOCKET_PATH'] ?? '/tmp/ts-bridge.sock';

// Cache descriptors after first successful load
let cachedDescriptors: ReturnType<typeof getToolDescriptors> | null = null;

function getDescriptors() {
  if (cachedDescriptors === null) {
    cachedDescriptors = getToolDescriptors();
  }
  return cachedDescriptors;
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10 MiB

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function sendJSON(res: http.ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/health') {
    sendJSON(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'GET' && pathname === '/tools') {
    try {
      sendJSON(res, 200, getDescriptors());
    } catch (err) {
      process.stderr.write(`ts-bridge: error loading tools: ${err}\n`);
      sendJSON(res, 500, { error: 'Failed to load tools' });
    }
    return;
  }

  // Match POST /tools/:name
  if (req.method === 'POST' && pathname.startsWith('/tools/')) {
    const toolName = decodeURIComponent(pathname.slice('/tools/'.length));

    res.setHeader('Content-Type', 'application/x-ndjson');

    let body: string;
    try {
      body = await readBody(req);
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'failed to read request body' }) + '\n');
      return;
    }

    let parsed: { input?: unknown; context?: BridgeContext };
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid request body' }) + '\n');
      return;
    }

    if (!parsed.context?.appId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'missing required field: context.appId' }) + '\n');
      return;
    }

    const bridgeContext: BridgeContext = {
      appId: parsed.context.appId,
      sessionId: parsed.context?.sessionId,
      conversationId: parsed.context?.conversationId,
      userId: parsed.context?.userId,
    };

    try {
      const TOOL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
      const signal = AbortSignal.timeout(TOOL_TIMEOUT_MS);
      const result = await new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        executeTool(toolName, parsed.input ?? {}, bridgeContext).then(resolve, reject);
      });
      res.writeHead(200);
      res.end(JSON.stringify({ chunk: result }) + '\n');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
      const statusCode = (err as { statusCode?: number }).statusCode === 404 ? 404 : isTimeout ? 504 : 500;
      res.writeHead(statusCode);
      res.end(JSON.stringify({ error: message }) + '\n');
      if (statusCode === 500) {
        process.stderr.write(`ts-bridge: tool execution error [${toolName}]: ${err}\n`);
      }
    }
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
});

// Remove stale socket file before listening, but only if it's actually a socket.
if (fs.existsSync(socketPath)) {
  const stat = fs.lstatSync(socketPath);
  if (stat.isSocket()) {
    fs.unlinkSync(socketPath);
  } else {
    process.stderr.write(`ts-bridge: ${socketPath} exists but is not a socket, refusing to remove\n`);
    process.exit(1);
  }
}

server.listen(socketPath, () => {
  process.stderr.write(`ts-bridge listening on ${socketPath}\n`);
});

function shutdown(): void {
  server.close(() => {
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Already removed
    }
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
