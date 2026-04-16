#!/usr/bin/env node

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const PROXY_PORT = process.env.PROXY_PORT || 8888;
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'https://api.openai.com';

let requestCounter = 0;

function ts() {
  return new Date().toISOString();
}

// Dim grey for metadata, reset after
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

const server = http.createServer((req, res) => {
  const requestId = ++requestCounter;
  const tag = `${CYAN}[${requestId}]${RESET}`;
  const upstream = new URL(UPSTREAM_URL);
  const targetUrl = new URL(req.url, UPSTREAM_URL);
  const isSSE = req.headers.accept?.includes('text/event-stream') ||
    req.url.includes('/chat/completions') ||
    req.url.includes('/v1/messages');

  let requestBody = [];

  req.on('data', (chunk) => {
    requestBody.push(chunk);
  });

  req.on('end', () => {
    const requestBodyBuffer = Buffer.concat(requestBody);

    // Log request summary
    console.log(`\n${tag} ${YELLOW}>>> ${req.method} ${req.url}${RESET}  ${DIM}${ts()}${RESET}`);

    // Show model from request body if present
    try {
      const body = JSON.parse(requestBodyBuffer.toString('utf8'));
      if (body.model) {
        console.log(`${tag}   model: ${body.model}  stream: ${body.stream ?? false}`);
      }
    } catch {}

    const reqStart = performance.now();

    const options = {
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: upstream.hostname
      }
    };

    const client = upstream.protocol === 'https:' ? https : http;

    const proxyReq = client.request(options, (proxyRes) => {
      const ttfb = (performance.now() - reqStart).toFixed(0);
      console.log(`${tag} ${GREEN}<<< ${proxyRes.statusCode}${RESET}  TTFB: ${ttfb}ms  ${DIM}${ts()}${RESET}`);

      let chunkIndex = 0;
      let totalBytes = 0;
      let lastChunkTime = performance.now();

      proxyRes.on('data', (chunk) => {
        const now = performance.now();
        const delta = (now - lastChunkTime).toFixed(0);
        const elapsed = (now - reqStart).toFixed(0);
        totalBytes += chunk.length;
        chunkIndex++;

        const chunkStr = chunk.toString('utf8');

        if (isSSE) {
          // Parse SSE lines — handles both OpenAI and Anthropic formats
          const lines = chunkStr.split('\n');
          let currentEvent = null;
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) { currentEvent = null; continue; }

            // Track event type from "event:" lines (Anthropic format)
            if (trimmed.startsWith('event: ')) {
              currentEvent = trimmed.slice(7);
              continue;
            }

            if (trimmed === 'data: [DONE]') {
              console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  [DONE]`);
              continue;
            }

            if (!trimmed.startsWith('data: ')) continue;

            try {
              const evt = JSON.parse(trimmed.slice(6));

              // === Anthropic SSE format ===
              if (currentEvent || evt.type) {
                const evtType = currentEvent || evt.type;

                if (evtType === 'content_block_start') {
                  const block = evt.content_block;
                  if (block?.type === 'tool_use') {
                    console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${YELLOW}tool_use: ${block.name}${RESET} (id: ${block.id})`);
                  } else if (block?.type === 'text') {
                    console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${DIM}text_start${RESET}`);
                  } else {
                    console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${DIM}block_start: ${block?.type || '?'}${RESET}`);
                  }
                } else if (evtType === 'content_block_delta') {
                  const d = evt.delta;
                  if (d?.type === 'text_delta' && d.text != null) {
                    const display = d.text.replace(/\n/g, '\\n').slice(0, 120);
                    console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${display}`);
                  } else if (d?.type === 'input_json_delta' && d.partial_json != null) {
                    const display = d.partial_json.replace(/\n/g, '\\n').slice(0, 120);
                    console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${DIM}json: ${display}${RESET}`);
                  } else {
                    console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${DIM}delta: ${d?.type || '?'}${RESET}`);
                  }
                } else if (evtType === 'content_block_stop') {
                  console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${DIM}block_stop${RESET}`);
                } else if (evtType === 'message_start') {
                  const model = evt.message?.model || '?';
                  console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${DIM}message_start model=${model}${RESET}`);
                } else if (evtType === 'message_delta') {
                  const reason = evt.delta?.stop_reason;
                  const usage = evt.usage;
                  console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  stop: ${reason}${usage ? `  out_tokens: ${usage.output_tokens}` : ''}`);
                } else if (evtType === 'message_stop') {
                  console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${GREEN}message_stop${RESET}`);
                } else {
                  console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${DIM}${evtType}${RESET}`);
                }
                continue;
              }

              // === OpenAI SSE format ===
              const content = evt.choices?.[0]?.delta?.content;
              const toolCall = evt.choices?.[0]?.delta?.tool_calls?.[0];
              const finishReason = evt.choices?.[0]?.finish_reason;

              if (content != null) {
                const display = content.replace(/\n/g, '\\n');
                console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${display}`);
              } else if (toolCall) {
                const fnName = toolCall.function?.name;
                const fnArgs = toolCall.function?.arguments ?? '';
                if (fnName) {
                  console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${YELLOW}tool_call: ${fnName}${RESET}`);
                }
                if (fnArgs) {
                  const display = fnArgs.replace(/\n/g, '\\n');
                  console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${DIM}args: ${display}${RESET}`);
                }
              } else if (finishReason) {
                console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  finish: ${finishReason}`);
              } else {
                const evtType = evt.object || evt.type || 'event';
                console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${DIM}${evtType}${RESET}`);
              }
            } catch {
              console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms${RESET}  ${trimmed.slice(0, 200)}`);
            }
          }
        } else {
          // Non-SSE: just show chunk size and timing
          console.log(`${tag}   ${DIM}#${chunkIndex} +${delta}ms ${elapsed}ms  ${chunk.length}B${RESET}`);
        }

        lastChunkTime = now;
      });

      proxyRes.on('end', () => {
        const total = (performance.now() - reqStart).toFixed(0);
        console.log(`${tag} ${GREEN}--- done${RESET}  ${totalBytes}B  ${chunkIndex} chunks  ${total}ms total`);
      });

      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error(`${tag} ${RED}ERR${RESET} ${err.message}`);
      res.writeHead(502);
      res.end('Bad Gateway');
    });

    if (requestBodyBuffer.length > 0) {
      proxyReq.write(requestBodyBuffer);
    }
    proxyReq.end();
  });
});

server.listen(PROXY_PORT, () => {
  console.log(`${GREEN}Debug proxy listening on port ${PROXY_PORT}${RESET}`);
  console.log(`Forwarding to: ${UPSTREAM_URL}`);
  console.log();
  console.log('Usage:');
  console.log(`  UPSTREAM_URL=${UPSTREAM_URL} PROXY_PORT=${PROXY_PORT} node debug-proxy.js`);
  console.log();
  console.log('Add to agents/.env (temporarily):');
  console.log(`  OPENAI_BASE_URL=http://localhost:${PROXY_PORT}      # catches embeddings`);
  console.log(`  ANTHROPIC_BASE_URL=http://localhost:${PROXY_PORT}   # catches LLM chat calls`);
  console.log();
  console.log('Output columns:  #chunk  +delta_ms  elapsed_ms  content');
  console.log('Key metrics:');
  console.log('  TTFB        = time to first byte from upstream (model thinking time)');
  console.log('  +delta      = gap between consecutive chunks (streaming stalls)');
  console.log('  elapsed     = total time since request sent');
});
