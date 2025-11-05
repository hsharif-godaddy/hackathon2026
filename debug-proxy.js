#!/usr/bin/env node

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PROXY_PORT = process.env.PROXY_PORT || 8888;
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'https://api.openai.com';

const logBaseDir = path.join(__dirname, 'proxy-logs');
let requestCounter = 0;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getLogDir() {
  const date = new Date().toISOString().split('T')[0];
  const dateDir = path.join(logBaseDir, date);
  ensureDir(dateDir);
  return dateDir;
}

function writeLog(requestDir, filename, content) {
  ensureDir(requestDir);
  fs.writeFileSync(path.join(requestDir, filename), content, 'utf8');
}

function formatHeaders(headers) {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

const server = http.createServer((req, res) => {
  const requestId = ++requestCounter;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const requestDir = path.join(getLogDir(), `request-${timestamp}-${requestId}`);
  
  const upstream = new URL(UPSTREAM_URL);
  const targetUrl = new URL(req.url, UPSTREAM_URL);
  
  let requestBody = [];
  
  req.on('data', (chunk) => {
    requestBody.push(chunk);
  });
  
  req.on('end', () => {
    const requestBodyBuffer = Buffer.concat(requestBody);
    
    writeLog(requestDir, 'request-headers.txt', 
      `${req.method} ${req.url} HTTP/${req.httpVersion}\n` +
      `Host: ${req.headers.host}\n` +
      formatHeaders(req.headers)
    );
    
    writeLog(requestDir, 'request-body.txt', requestBodyBuffer.toString('utf8'));
    
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
      writeLog(requestDir, 'response-headers.txt',
        `HTTP/${proxyRes.httpVersion} ${proxyRes.statusCode} ${proxyRes.statusMessage}\n` +
        formatHeaders(proxyRes.headers)
      );
      
      let responseBody = [];
      
      proxyRes.on('data', (chunk) => {
        responseBody.push(chunk);
      });
      
      proxyRes.on('end', () => {
        const responseBodyBuffer = Buffer.concat(responseBody);
        writeLog(requestDir, 'response-body.txt', responseBodyBuffer.toString('utf8'));
        
        console.log(`[${requestId}] ${req.method} ${req.url} -> ${proxyRes.statusCode} (${responseBodyBuffer.length} bytes)`);
        console.log(`     Logged to: ${requestDir}`);
      });
      
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
      console.error(`[${requestId}] Proxy error:`, err.message);
      writeLog(requestDir, 'error.txt', err.stack);
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
  console.log(`Debug proxy listening on port ${PROXY_PORT}`);
  console.log(`Forwarding to: ${UPSTREAM_URL}`);
  console.log(`Logs directory: ${logBaseDir}`);
  console.log();
  console.log('Usage:');
  console.log(`  export OPENAI_BASE_URL=http://localhost:${PROXY_PORT}`);
  console.log('  # Then run your application');
});
