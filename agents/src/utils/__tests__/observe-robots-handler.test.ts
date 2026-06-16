import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error - .js import of plain ESM script outside the TS rootDir
import { inspectEntryTs, observeRobotsHandler } from '../../../../container-scripts/preview/observe-robots-handler.js';

// Historical handler shapes we want to classify across the fleet. The
// observer only *classifies* — it never rewrites. Identifying excerpts
// only; full file context is added per-test as needed.
const SHAPE_A_PRE_RUBICON_373 = `app.get("/robots.txt", (req, res) => {
  const base = baseUrl(req);
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    \`Sitemap: \${base}/sitemap.xml\`,
  ].join("\\n");
  res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(body);
});`;

const SHAPE_B_SEO_INDEX_MODE = `app.get("/robots.txt", (req, res) => {
  if (process.env.SEO_INDEX_MODE !== "allow") {
    res.type("text/plain").set("Cache-Control", "public, max-age=3600")
      .send("User-agent: *\\nDisallow: /\\n");
    return;
  }
  const base = baseUrl(req);
  res.type("text/plain").send(\`User-agent: *\\nAllow: /\\nSitemap: \${base}/sitemap.xml\\n\`);
});`;

const SHAPE_C_IS_CANONICAL_HOST = `app.get("/robots.txt", (req, res) => {
  if (!isCanonicalHost(req)) {
    res.type("text/plain").set("Cache-Control", "public, max-age=3600")
      .send("User-agent: *\\nDisallow: /\\n");
    return;
  }
  res.type("text/plain").send("User-agent: *\\nAllow: /\\n");
});`;

const SHAPE_D_IS_SYSTEM_HOST = `app.get("/robots.txt", (req, res) => {
  if (isSystemHost(req)) {
    res.type("text/plain").set("Cache-Control", "public, max-age=3600")
      .send("User-agent: *\\nDisallow: /\\n");
    return;
  }
  res.type("text/plain").send("User-agent: *\\nAllow: /\\n");
});`;

const SHAPE_E_CURRENT = `const AIRO_PREVIEW_SUFFIXES = [".airoapp.ai", ".test-airoapp.ai"];
function isAiroPreviewHost(req) {
  const h = (req.hostname || "").toLowerCase();
  return AIRO_PREVIEW_SUFFIXES.some((s) => h.endsWith(s));
}
app.get("/robots.txt", (req, res) => {
  if (isAiroPreviewHost(req)) {
    res.type("text/plain").send("User-agent: *\\nDisallow: /\\n");
    return;
  }
  res.type("text/plain").send("User-agent: *\\nAllow: /\\n");
});`;

const UNKNOWN_SHAPE = `app.get("/robots.txt", (req, res) => {
  // Customer wrote something we did not anticipate. No Allow, no host gate,
  // no SEO_INDEX_MODE — just a custom message.
  res.type("text/plain").send("Hello from /robots.txt\\n");
});`;

function fileWith(handlerSrc: string): string {
  return `import express from "express";
const app = express();
${handlerSrc}
export default app;
`;
}

describe('inspectEntryTs (pure)', () => {
  it('classifies Shape A (pre-RUBICON-373 always-allow)', () => {
    const result = inspectEntryTs(fileWith(SHAPE_A_PRE_RUBICON_373));
    expect(result.shape).toBe('A');
    expect(result.robotsHandlerHash).toMatch(/^[a-f0-9]{32}$/);
    expect(result.hasSitemap).toBe(false);
  });

  it('classifies Shape B (SEO_INDEX_MODE env-gated)', () => {
    const result = inspectEntryTs(fileWith(SHAPE_B_SEO_INDEX_MODE));
    expect(result.shape).toBe('B');
  });

  it('classifies Shape C (isCanonicalHost gate)', () => {
    const result = inspectEntryTs(fileWith(SHAPE_C_IS_CANONICAL_HOST));
    expect(result.shape).toBe('C');
  });

  it('classifies Shape D (isSystemHost interim)', () => {
    const result = inspectEntryTs(fileWith(SHAPE_D_IS_SYSTEM_HOST));
    expect(result.shape).toBe('D');
  });

  it('classifies Shape E (already on the post-RUBICON-373 contract)', () => {
    const result = inspectEntryTs(fileWith(SHAPE_E_CURRENT));
    expect(result.shape).toBe('E');
  });

  it('returns shape=null on a handler that matches no known shape', () => {
    const result = inspectEntryTs(fileWith(UNKNOWN_SHAPE));
    expect(result.shape).toBe(null);
    expect(result.robotsHandlerHash).toMatch(/^[a-f0-9]{32}$/);
  });

  it('returns robots_handler_not_found when no /robots.txt handler exists', () => {
    const source = `import express from "express";
const app = express();
app.get("/api/health", (req, res) => res.send("ok"));
export default app;
`;
    expect(inspectEntryTs(source)).toEqual({ reason: 'robots_handler_not_found' });
  });

  it('returns parse_failed on syntactically broken input', () => {
    const result = inspectEntryTs('this is not { valid typescript ::');
    expect(result.reason).toBe('parse_failed');
    expect(typeof result.error).toBe('string');
  });

  it('hashes equal handler bodies to the same value regardless of surrounding whitespace', () => {
    const dense = fileWith(SHAPE_B_SEO_INDEX_MODE);
    const padded = fileWith(`\n\n  ${SHAPE_B_SEO_INDEX_MODE}\n\n`);
    const a = inspectEntryTs(dense);
    const b = inspectEntryTs(padded);
    expect(a.robotsHandlerHash).toBe(b.robotsHandlerHash);
  });

  it('reports the sitemap hash when /sitemap.xml is also present', () => {
    const source = `import express from "express";
const app = express();
${SHAPE_B_SEO_INDEX_MODE}
app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send("<urlset><url><loc>https://x</loc></url></urlset>");
});
export default app;
`;
    const result = inspectEntryTs(source);
    expect(result.shape).toBe('B');
    expect(result.hasSitemap).toBe(true);
    expect(result.sitemapHash).toMatch(/^[a-f0-9]{32}$/);
  });

  it('hasSitemap=false and sitemapHash=null when /sitemap.xml is absent', () => {
    const result = inspectEntryTs(fileWith(SHAPE_A_PRE_RUBICON_373));
    expect(result.hasSitemap).toBe(false);
    expect(result.sitemapHash).toBe(null);
  });

  it('Shape E wins over Shape A even when the handler body looks like A', () => {
    // Patched apps still have an `Allow: /` + `Sitemap:` reachable branch in
    // the handler body. Without the source-level fingerprint check, those
    // would mis-classify as Shape A and inflate the would-apply bucket.
    const source = `const AIRO_PREVIEW_SUFFIXES = [".airoapp.ai", ".test-airoapp.ai"];
import express from "express";
const app = express();
app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("User-agent: *\\nAllow: /\\n\\nSitemap: x\\n");
});
export default app;
`;
    expect(inspectEntryTs(source).shape).toBe('E');
  });
});

describe('observeRobotsHandler (filesystem)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'observe-robots-handler-'));
    mkdirSync(join(dir, 'src/server'), { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns entry_ts_missing when the file does not exist', () => {
    expect(observeRobotsHandler(dir)).toEqual({
      status: 'skipped',
      reason: 'entry_ts_missing',
    });
  });

  it('emits status=observed reason=env_gated for a Shape B file', () => {
    writeFileSync(join(dir, 'src/server/entry.ts'), fileWith(SHAPE_B_SEO_INDEX_MODE), 'utf8');
    const result = observeRobotsHandler(dir);
    expect(result.status).toBe('observed');
    expect(result.reason).toBe('env_gated');
    expect(result.shape).toBe('B');
    expect(result.robotsHandlerHash).toMatch(/^[a-f0-9]{32}$/);
    expect(result.hasSitemap).toBe(false);
  });

  it('emits reason=airo_suffix_gated for Shape E', () => {
    writeFileSync(join(dir, 'src/server/entry.ts'), fileWith(SHAPE_E_CURRENT), 'utf8');
    const result = observeRobotsHandler(dir);
    expect(result.reason).toBe('airo_suffix_gated');
    expect(result.shape).toBe('E');
  });

  it('emits reason=unknown_shape with no body excerpt by default', () => {
    writeFileSync(join(dir, 'src/server/entry.ts'), fileWith(UNKNOWN_SHAPE), 'utf8');
    const result = observeRobotsHandler(dir);
    expect(result.reason).toBe('unknown_shape');
    expect(result.shape).toBe(null);
    // Body excerpt is gated behind LOG_ROBOTS_HANDLER_BODY=1 — not present here.
    expect('robotsHandlerBody' in result).toBe(false);
  });

  it('attaches robotsHandlerBody for unknown_shape when LOG_ROBOTS_HANDLER_BODY=1', () => {
    const original = process.env.LOG_ROBOTS_HANDLER_BODY;
    process.env.LOG_ROBOTS_HANDLER_BODY = '1';
    try {
      writeFileSync(join(dir, 'src/server/entry.ts'), fileWith(UNKNOWN_SHAPE), 'utf8');
      const result = observeRobotsHandler(dir);
      expect(result.reason).toBe('unknown_shape');
      expect(typeof result.robotsHandlerBody).toBe('string');
      expect(result.robotsHandlerBody).toContain('Hello from /robots.txt');
    } finally {
      if (original === undefined) delete process.env.LOG_ROBOTS_HANDLER_BODY;
      else process.env.LOG_ROBOTS_HANDLER_BODY = original;
    }
  });

  it('attaches entrySrcExcerpt for parse_failed when LOG_ROBOTS_HANDLER_BODY=1', () => {
    const original = process.env.LOG_ROBOTS_HANDLER_BODY;
    process.env.LOG_ROBOTS_HANDLER_BODY = '1';
    try {
      writeFileSync(join(dir, 'src/server/entry.ts'), 'this is not { valid typescript ::', 'utf8');
      const result = observeRobotsHandler(dir);
      expect(result.reason).toBe('parse_failed');
      expect(typeof result.entrySrcExcerpt).toBe('string');
      expect(result.entrySrcExcerpt).toContain('this is not');
    } finally {
      if (original === undefined) delete process.env.LOG_ROBOTS_HANDLER_BODY;
      else process.env.LOG_ROBOTS_HANDLER_BODY = original;
    }
  });

  it('emits reason=robots_handler_not_found for entry.ts without robots route', () => {
    writeFileSync(
      join(dir, 'src/server/entry.ts'),
      `import express from "express";
const app = express();
app.get("/api/health", (req, res) => res.send("ok"));
export default app;
`,
      'utf8',
    );
    const result = observeRobotsHandler(dir);
    expect(result.status).toBe('observed');
    expect(result.reason).toBe('robots_handler_not_found');
  });

  it('emits reason=parse_failed when entry.ts is syntactically broken', () => {
    writeFileSync(join(dir, 'src/server/entry.ts'), 'this is not { valid typescript ::', 'utf8');
    const result = observeRobotsHandler(dir);
    expect(result.status).toBe('observed');
    expect(result.reason).toBe('parse_failed');
    expect(typeof result.error).toBe('string');
  });
});
