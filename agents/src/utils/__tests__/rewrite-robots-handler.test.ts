import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
// @ts-expect-error - .js import of plain ESM script outside the TS rootDir
import {
  rewriteEntryTs,
  rewriteRobotsHandler,
  verifyShapeD,
} from '../../../../container-scripts/preview/rewrite-robots-handler.js';
// @ts-expect-error - .js import of plain ESM script outside the TS rootDir
import { inspectEntryTs } from '../../../../container-scripts/preview/observe-robots-handler.js';

const NO_GATE: { allowlist: null } = { allowlist: null };
const rewriteEntryTsAny: (source: string) => unknown = (source: string) => rewriteEntryTs(source, NO_GATE);
const rewriteRobotsHandlerAny: (dir: string) => unknown = (dir: string) => rewriteRobotsHandler(dir, NO_GATE);

const SHAPE_A_PRE_RUBICON_373: string = `app.get("/robots.txt", (req, res) => {
  const base = baseUrl(req);
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    \`Sitemap: \${base}/sitemap.xml\`,
  ].join("\\n");
  res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(body);
});`;

const SHAPE_A_WITH_UNTOUCHED_SITEMAP: string = `app.get("/robots.txt", (req, res) => {
  const base = baseUrl(req);
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    \`Sitemap: \${base}/sitemap.xml\`,
  ].join("\\n");
  res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(body);
});

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send("<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?><urlset xmlns=\\"http://www.sitemaps.org/schemas/sitemap/0.9\\"><url><loc>https://example.com/</loc></url></urlset>");
});`;

const SHAPE_B_SEO_INDEX_MODE: string = `app.get("/robots.txt", (req, res) => {
  if (process.env.SEO_INDEX_MODE !== "allow") {
    res.type("text/plain").set("Cache-Control", "public, max-age=3600")
      .send("User-agent: *\\nDisallow: /\\n");
    return;
  }
  const base = baseUrl(req);
  res.type("text/plain").send(\`User-agent: *\\nAllow: /\\nSitemap: \${base}/sitemap.xml\\n\`);
});`;

const SHAPE_C_IS_CANONICAL_HOST: string = `app.get("/robots.txt", (req, res) => {
  if (!isCanonicalHost(req)) {
    res.type("text/plain").set("Cache-Control", "public, max-age=3600")
      .send("User-agent: *\\nDisallow: /\\n");
    return;
  }
  res.type("text/plain").send("User-agent: *\\nAllow: /\\n");
});`;

const SHAPE_D_IS_SYSTEM_HOST: string = `app.get("/robots.txt", (req, res) => {
  if (isSystemHost(req)) {
    res.type("text/plain").set("Cache-Control", "public, max-age=3600")
      .send("User-agent: *\\nDisallow: /\\n");
    return;
  }
  res.type("text/plain").send("User-agent: *\\nAllow: /\\n");
});`;

const SHAPE_E_CURRENT: string = `const AIRO_PREVIEW_SUFFIXES = [".airoapp.ai", ".test-airoapp.ai"];
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

const UNKNOWN_SHAPE: string = `app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("Hello from /robots.txt\\n");
});`;

function fileWith(handlerSrc: string): string {
  return `import express from "express";
function baseUrl(req) { return \`\${req.protocol}://\${req.hostname}\`; }
const seoRoutes = [];
function escapeXml(s) { return s; }
const app = express();
${handlerSrc}
export default app;
`;
}

function fileWithoutBaseUrl(handlerSrc: string): string {
  return `import express from "express";
const seoRoutes = [];
function escapeXml(s) { return s; }
const app = express();
${handlerSrc}
export default app;
`;
}

describe('rewriteEntryTs (pure)', () => {
  it('rewrites Shape A /robots.txt handler to Shape D', () => {
    const result: { status: string; source?: string; addedImport?: boolean } =
      rewriteEntryTsAny(fileWith(SHAPE_A_PRE_RUBICON_373));
    expect(result.status).toBe('rewritten');
    expect(result.source).toContain('isSystemHost(req)');
    expect(result.addedImport).toBe(true);
  });

  it('post-rewrite source classifies as Shape D', () => {
    const result: { status: string; source?: string } = rewriteEntryTsAny(fileWith(SHAPE_A_PRE_RUBICON_373));
    expect(result.status).toBe('rewritten');
    const reInspect: { shape?: string | null } = inspectEntryTs(result.source!);
    expect(reInspect.shape).toBe('D');
  });

  it('inserts import { isSystemHost } from "./seo-host" exactly once', () => {
    const result: { status: string; source?: string } = rewriteEntryTsAny(fileWith(SHAPE_A_PRE_RUBICON_373));
    expect(result.status).toBe('rewritten');
    const matches: RegExpMatchArray | null = result.source!.match(/import \{ isSystemHost \} from "\.\/seo-host"/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });

  it('does not re-insert import when one already exists', () => {
    const sourceWithImport: string = `import express from "express";
import { isSystemHost } from "./seo-host";
function baseUrl(req) { return ""; }
const seoRoutes = [];
function escapeXml(s) { return s; }
const app = express();
${SHAPE_A_PRE_RUBICON_373}
export default app;
`;
    const result: { status: string; source?: string; addedImport?: boolean } = rewriteEntryTsAny(sourceWithImport);
    expect(result.status).toBe('rewritten');
    expect(result.addedImport).toBe(false);
    const matches: RegExpMatchArray | null = result.source!.match(/import \{ isSystemHost \}/g);
    expect(matches!.length).toBe(1);
  });

  it('rewrites /robots.txt and leaves /sitemap.xml handler byte-for-byte unchanged', () => {
    const input: string = fileWith(SHAPE_A_WITH_UNTOUCHED_SITEMAP);
    const result: { status: string; source?: string } = rewriteEntryTsAny(input);
    expect(result.status).toBe('rewritten');
    expect(result.source).toContain('isSystemHost(req)');
    const sitemapBlock: RegExpMatchArray | null = input.match(/app\.get\("\/sitemap\.xml"[\s\S]+?\}\);/);
    expect(sitemapBlock).not.toBeNull();
    expect(result.source).toContain(sitemapBlock![0]);
  });

  it('no-ops on Shape B (env-gated)', () => {
    const result: { status: string; reason?: string } = rewriteEntryTsAny(fileWith(SHAPE_B_SEO_INDEX_MODE));
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('shape_B');
  });

  it('no-ops on Shape C (canonical-host-gated)', () => {
    const result: { status: string; reason?: string } = rewriteEntryTsAny(fileWith(SHAPE_C_IS_CANONICAL_HOST));
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('shape_C');
  });

  it('no-ops on Shape D (already system-host-gated)', () => {
    const result: { status: string; reason?: string } = rewriteEntryTsAny(fileWith(SHAPE_D_IS_SYSTEM_HOST));
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('shape_D');
  });

  it('no-ops on Shape E (already on canonical contract)', () => {
    const result: { status: string; reason?: string } = rewriteEntryTsAny(fileWith(SHAPE_E_CURRENT));
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('shape_E');
  });

  it('no-ops on unknown shapes', () => {
    const result: { status: string; reason?: string } = rewriteEntryTsAny(fileWith(UNKNOWN_SHAPE));
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('unknown_shape');
  });

  it('no-ops when the /robots.txt handler is missing entirely', () => {
    const source: string = `import express from "express";
const app = express();
app.get("/api/health", (req, res) => res.send("ok"));
export default app;
`;
    const result: { status: string; reason?: string } = rewriteEntryTsAny(source);
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('robots_handler_not_found');
  });

  it('returns parse_failed on syntactically broken input', () => {
    const result: { status: string; error?: string } = rewriteEntryTsAny('this is not { valid typescript ::');
    expect(result.status).toBe('parse_failed');
    expect(typeof result.error).toBe('string');
  });

  it('is idempotent when applied twice (second pass is a no-op)', () => {
    const first: { status: string; source?: string } = rewriteEntryTsAny(fileWith(SHAPE_A_PRE_RUBICON_373));
    expect(first.status).toBe('rewritten');
    const second: { status: string; reason?: string } = rewriteEntryTsAny(first.source!);
    expect(second.status).toBe('no_op');
    expect(second.reason).toBe('shape_D');
  });

  it('emits oldShape, newShape, oldHash, newHash on rewrite', () => {
    const result: {
      status: string;
      oldShape?: string;
      newShape?: string;
      oldHash?: string;
      newHash?: string;
    } = rewriteEntryTsAny(fileWith(SHAPE_A_PRE_RUBICON_373));
    expect(result.status).toBe('rewritten');
    expect(result.oldShape).toBe('A');
    expect(result.newShape).toBe('D');
    expect(result.oldHash).toMatch(/^[a-f0-9]{32}$/);
    expect(result.newHash).toMatch(/^[a-f0-9]{32}$/);
    expect(result.oldHash).not.toBe(result.newHash);
  });

  it('no-ops with missing_robots_deps when baseUrl is absent at top level', () => {
    const result: { status: string; reason?: string; missing?: string[] } =
      rewriteEntryTsAny(fileWithoutBaseUrl(SHAPE_A_PRE_RUBICON_373));
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('missing_robots_deps');
    expect(result.missing).toEqual(['baseUrl']);
  });

  it('recognizes baseUrl declared via const arrow function', () => {
    const source: string = `import express from "express";
const baseUrl = (req) => \`\${req.protocol}://\${req.hostname}\`;
const seoRoutes = [];
function escapeXml(s) { return s; }
const app = express();
${SHAPE_A_PRE_RUBICON_373}
export default app;
`;
    const result: { status: string } = rewriteEntryTsAny(source);
    expect(result.status).toBe('rewritten');
  });

});

describe('verifyShapeD', () => {
  it('returns true for a Shape D source', () => {
    expect(verifyShapeD(fileWith(SHAPE_D_IS_SYSTEM_HOST))).toBe(true);
  });

  it('returns false for a Shape A source', () => {
    expect(verifyShapeD(fileWith(SHAPE_A_PRE_RUBICON_373))).toBe(false);
  });

  it('returns false for parse-broken input', () => {
    expect(verifyShapeD('not parseable {::')).toBe(false);
  });
});

describe('rewriteRobotsHandler (filesystem)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rewrite-robots-handler-'));
    mkdirSync(join(dir, 'src/server'), { recursive: true });
    execFileSync('git', ['init', '--initial-branch=main', '--quiet'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function commitFile(relPath: string, contents: string): void {
    writeFileSync(join(dir, relPath), contents, 'utf8');
    execFileSync('git', ['add', relPath], { cwd: dir });
    execFileSync('git', ['commit', '-m', `add ${relPath}`, '--quiet'], { cwd: dir });
  }

  it('returns entry_ts_missing when entry.ts does not exist', () => {
    expect(rewriteRobotsHandlerAny(dir)).toEqual({
      status: 'skipped',
      reason: 'entry_ts_missing',
    });
  });

  it('rewrites Shape A entry.ts and writes seo-host.ts', () => {
    commitFile('src/server/entry.ts', fileWith(SHAPE_A_PRE_RUBICON_373));
    const result: {
      status: string;
      addedImport?: boolean;
      seoHostCreated?: boolean;
      oldShape?: string;
      newShape?: string;
      oldHash?: string;
      newHash?: string;
    } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('rewritten');
    expect(result.addedImport).toBe(true);
    expect(result.seoHostCreated).toBe(true);
    expect(result.oldShape).toBe('A');
    expect(result.newShape).toBe('D');
    expect(result.oldHash).toMatch(/^[a-f0-9]{32}$/);
    expect(result.newHash).toMatch(/^[a-f0-9]{32}$/);
    expect(result.oldHash).not.toBe(result.newHash);

    const written: string = readFileSync(join(dir, 'src/server/entry.ts'), 'utf8');
    expect(written).toContain('isSystemHost(req)');
    expect(written).toContain('import { isSystemHost } from "./seo-host"');

    const seoHost: string = readFileSync(join(dir, 'src/server/seo-host.ts'), 'utf8');
    expect(seoHost).toContain('export function isSystemHost');
    expect(seoHost).toContain('SYSTEM_HOST_SUFFIXES');
  });

  it('does not overwrite an existing seo-host.ts', () => {
    commitFile('src/server/entry.ts', fileWith(SHAPE_A_PRE_RUBICON_373));
    const customSeoHost: string = '// custom seo host file\nexport function isSystemHost() { return false; }\n';
    commitFile('src/server/seo-host.ts', customSeoHost);

    const result: { status: string; seoHostCreated?: boolean } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('rewritten');
    expect(result.seoHostCreated).toBe(false);
    expect(readFileSync(join(dir, 'src/server/seo-host.ts'), 'utf8')).toBe(customSeoHost);
  });

  it('skips with seo_host_invalid when an existing seo-host.ts is missing the isSystemHost export', () => {
    const originalEntry: string = fileWith(SHAPE_A_PRE_RUBICON_373);
    commitFile('src/server/entry.ts', originalEntry);
    const brokenSeoHost: string = '// hand-modified by customer\nexport const NOTHING = true;\n';
    commitFile('src/server/seo-host.ts', brokenSeoHost);

    const result: { status: string; reason?: string } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('seo_host_invalid');
    expect(readFileSync(join(dir, 'src/server/entry.ts'), 'utf8')).toBe(originalEntry);
    expect(readFileSync(join(dir, 'src/server/seo-host.ts'), 'utf8')).toBe(brokenSeoHost);
  });

  it('writes seo-host.ts before entry.ts when seo-host.ts is missing', () => {
    commitFile('src/server/entry.ts', fileWith(SHAPE_A_PRE_RUBICON_373));
    const result: { status: string; seoHostCreated?: boolean } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('rewritten');
    expect(result.seoHostCreated).toBe(true);

    const seoHost: string = readFileSync(join(dir, 'src/server/seo-host.ts'), 'utf8');
    expect(seoHost).toContain('export function isSystemHost');
    const entry: string = readFileSync(join(dir, 'src/server/entry.ts'), 'utf8');
    expect(entry).toContain('import { isSystemHost } from "./seo-host"');
  });

  it('skips when entry.ts has uncommitted changes (dirty tree)', () => {
    commitFile('src/server/entry.ts', fileWith(SHAPE_A_PRE_RUBICON_373));
    writeFileSync(
      join(dir, 'src/server/entry.ts'),
      fileWith(SHAPE_A_PRE_RUBICON_373) + '\n// unrelated dirty edit\n',
      'utf8',
    );

    const result: { status: string; reason?: string } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('entry_ts_dirty');
  });

  it('skips when seo-host.ts has uncommitted changes', () => {
    commitFile('src/server/entry.ts', fileWith(SHAPE_A_PRE_RUBICON_373));
    commitFile('src/server/seo-host.ts', '// initial\n');
    writeFileSync(join(dir, 'src/server/seo-host.ts'), '// dirty edit\n', 'utf8');

    const result: { status: string; reason?: string } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('seo_host_ts_dirty');
  });

  it('no-ops on Shape D (idempotent)', () => {
    commitFile('src/server/entry.ts', fileWith(SHAPE_D_IS_SYSTEM_HOST));
    const result: { status: string; reason?: string } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('shape_D');
  });

  it('no-ops on Shape E', () => {
    commitFile('src/server/entry.ts', fileWith(SHAPE_E_CURRENT));
    const result: { status: string; reason?: string } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('shape_E');
  });

  it('no-ops on Shape B (env-gated)', () => {
    commitFile('src/server/entry.ts', fileWith(SHAPE_B_SEO_INDEX_MODE));
    const result: { status: string; reason?: string } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('shape_B');
  });

  it('skips when entry.ts is unparseable', () => {
    commitFile('src/server/entry.ts', 'this is not { valid typescript ::');
    const result: { status: string; reason?: string } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('parse_failed');
  });

  it('rewriting the same file twice is idempotent', () => {
    commitFile('src/server/entry.ts', fileWith(SHAPE_A_PRE_RUBICON_373));
    const first: { status: string } = rewriteRobotsHandlerAny(dir);
    expect(first.status).toBe('rewritten');

    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'apply rewrite', '--quiet'], { cwd: dir });

    const second: { status: string; reason?: string } = rewriteRobotsHandlerAny(dir);
    expect(second.status).toBe('no_op');
    expect(second.reason).toBe('shape_D');
  });

  it('rewrites robots.txt and leaves /sitemap.xml handler byte-for-byte unchanged', () => {
    const input: string = fileWith(SHAPE_A_WITH_UNTOUCHED_SITEMAP);
    commitFile('src/server/entry.ts', input);
    const result: { status: string } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('rewritten');

    const written: string = readFileSync(join(dir, 'src/server/entry.ts'), 'utf8');
    expect(written).toContain('isSystemHost(req)');
    const sitemapBlock: RegExpMatchArray | null = input.match(/app\.get\("\/sitemap\.xml"[\s\S]+?\}\);/);
    expect(sitemapBlock).not.toBeNull();
    expect(written).toContain(sitemapBlock![0]);
  });

  it('skips with missing_robots_deps and surfaces the missing identifier list', () => {
    commitFile('src/server/entry.ts', fileWithoutBaseUrl(SHAPE_A_PRE_RUBICON_373));
    const result: { status: string; reason?: string; missing?: string[] } = rewriteRobotsHandlerAny(dir);
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('missing_robots_deps');
    expect(result.missing).toEqual(['baseUrl']);
  });
});

describe('hash allowlist gating', () => {
  it('default allowlist rejects a synthetic Shape A body with not_in_allowlist', () => {
    const result: { status: string; reason?: string; robotsHandlerHash?: string } =
      rewriteEntryTs(fileWith(SHAPE_A_PRE_RUBICON_373));
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('not_in_allowlist');
    expect(result.robotsHandlerHash).toMatch(/^[a-f0-9]{32}$/);
  });

  it('explicit allowlist containing the body hash unlocks the rewrite', () => {
    const wildcard: { status: string; oldHash?: string } = rewriteEntryTsAny(fileWith(SHAPE_A_PRE_RUBICON_373));
    expect(wildcard.status).toBe('rewritten');
    const fixtureHash: string = wildcard.oldHash!;

    const allowlistedResult: { status: string; oldHash?: string } = rewriteEntryTs(
      fileWith(SHAPE_A_PRE_RUBICON_373),
      { allowlist: new Set([fixtureHash]) },
    );
    expect(allowlistedResult.status).toBe('rewritten');
    expect(allowlistedResult.oldHash).toBe(fixtureHash);
  });

  it('null allowlist disables gating entirely (test-only convenience)', () => {
    const result: { status: string } = rewriteEntryTs(fileWith(SHAPE_A_PRE_RUBICON_373), { allowlist: null });
    expect(result.status).toBe('rewritten');
  });

  it('filesystem wrapper forwards allowlist option and surfaces the hash on skip', () => {
    const fsDir: string = mkdtempSync(join(tmpdir(), 'rewrite-allowlist-'));
    mkdirSync(join(fsDir, 'src/server'), { recursive: true });
    execFileSync('git', ['init', '--initial-branch=main', '--quiet'], { cwd: fsDir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: fsDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: fsDir });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: fsDir });
    writeFileSync(join(fsDir, 'src/server/entry.ts'), fileWith(SHAPE_A_PRE_RUBICON_373), 'utf8');
    execFileSync('git', ['add', '.'], { cwd: fsDir });
    execFileSync('git', ['commit', '-m', 'init', '--quiet'], { cwd: fsDir });

    const result: { status: string; reason?: string; robotsHandlerHash?: string } = rewriteRobotsHandler(fsDir);
    expect(result.status).toBe('no_op');
    expect(result.reason).toBe('not_in_allowlist');
    expect(result.robotsHandlerHash).toMatch(/^[a-f0-9]{32}$/);

    rmSync(fsDir, { recursive: true, force: true });
  });
});

type RewriteOptions = {
  allowlist?: Set<string> | null;
  verify?: (source: string) => boolean;
  writeFile?: (path: string, data: string, encoding: string) => void;
};

type RewriteResult = {
  status: string;
  reason?: string;
  error?: string;
  seoHostCreated?: boolean;
};

const rewriteRobotsHandlerWithOptions: (dir: string, opts: RewriteOptions) => RewriteResult =
  (dir: string, opts: RewriteOptions) => rewriteRobotsHandler(dir, opts) as RewriteResult;

describe('rewriteRobotsHandler failure paths', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rewrite-robots-fail-'));
    mkdirSync(join(dir, 'src/server'), { recursive: true });
    execFileSync('git', ['init', '--initial-branch=main', '--quiet'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  });

  afterEach(() => {
    if (existsSync(join(dir, 'src/server'))) {
      chmodSync(join(dir, 'src/server'), 0o755);
    }
    const entryPath: string = join(dir, 'src/server/entry.ts');
    if (existsSync(entryPath)) chmodSync(entryPath, 0o644);
    rmSync(dir, { recursive: true, force: true });
  });

  function commit(relPath: string, contents: string): void {
    writeFileSync(join(dir, relPath), contents, 'utf8');
    execFileSync('git', ['add', relPath], { cwd: dir });
    execFileSync('git', ['commit', '-m', `add ${relPath}`, '--quiet'], { cwd: dir });
  }

  it('seo_host_write_failed: returns failed and leaves entry.ts byte-for-byte unchanged', () => {
    const original: string = fileWith(SHAPE_A_PRE_RUBICON_373);
    commit('src/server/entry.ts', original);
    chmodSync(join(dir, 'src/server'), 0o555);

    const result: RewriteResult = rewriteRobotsHandlerWithOptions(dir, NO_GATE);

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('seo_host_write_failed');
    expect(readFileSync(join(dir, 'src/server/entry.ts'), 'utf8')).toBe(original);
    expect(existsSync(join(dir, 'src/server/seo-host.ts'))).toBe(false);
  });

  it('entry_ts_write_failed: rolls back run-created seo-host.ts and leaves entry.ts unchanged', () => {
    const original: string = fileWith(SHAPE_A_PRE_RUBICON_373);
    commit('src/server/entry.ts', original);
    chmodSync(join(dir, 'src/server/entry.ts'), 0o444);

    const calls: Array<{ path: string }> = [];
    const stubWrite: (p: string, data: string, encoding: string) => void = (
      p: string,
      data: string,
      encoding: string,
    ) => {
      calls.push({ path: p });
      if (p.endsWith('entry.ts')) {
        const err: NodeJS.ErrnoException = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      writeFileSync(p, data, encoding as BufferEncoding);
    };

    const result: RewriteResult = rewriteRobotsHandlerWithOptions(dir, {
      allowlist: null,
      writeFile: stubWrite,
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('entry_ts_write_failed');
    expect(readFileSync(join(dir, 'src/server/entry.ts'), 'utf8')).toBe(original);
    expect(existsSync(join(dir, 'src/server/seo-host.ts'))).toBe(false);
    expect(calls.some((c: { path: string }) => c.path.endsWith('seo-host.ts'))).toBe(true);
  });

  it('post_write_not_shape_d: verify failure restores entry.ts byte-for-byte and deletes run-created seo-host.ts', () => {
    const original: string = fileWith(SHAPE_A_PRE_RUBICON_373);
    commit('src/server/entry.ts', original);

    const result: RewriteResult & { seoHostCreated?: boolean } = rewriteRobotsHandlerWithOptions(dir, {
      allowlist: null,
      verify: () => false,
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('post_write_not_shape_d');
    expect(readFileSync(join(dir, 'src/server/entry.ts'), 'utf8')).toBe(original);
    expect(existsSync(join(dir, 'src/server/seo-host.ts'))).toBe(false);
  });

  it('post_write_not_shape_d: preserves a pre-existing seo-host.ts when rolling back', () => {
    const original: string = fileWith(SHAPE_A_PRE_RUBICON_373);
    commit('src/server/entry.ts', original);
    const customSeoHost: string = '// pre-existing\nexport function isSystemHost() { return true; }\n';
    commit('src/server/seo-host.ts', customSeoHost);

    const result: RewriteResult = rewriteRobotsHandlerWithOptions(dir, {
      allowlist: null,
      verify: () => false,
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('post_write_not_shape_d');
    expect(readFileSync(join(dir, 'src/server/entry.ts'), 'utf8')).toBe(original);
    expect(readFileSync(join(dir, 'src/server/seo-host.ts'), 'utf8')).toBe(customSeoHost);
  });

  it('verify_failed_restore_failed: surfaces the double-fault and still cleans up run-created seo-host.ts', () => {
    const original: string = fileWith(SHAPE_A_PRE_RUBICON_373);
    commit('src/server/entry.ts', original);

    let entryWrites: number = 0;
    const stubWrite: (p: string, data: string, encoding: string) => void = (
      p: string,
      data: string,
      encoding: string,
    ) => {
      if (p.endsWith('entry.ts')) {
        entryWrites += 1;
        if (entryWrites === 1) {
          writeFileSync(p, data, encoding as BufferEncoding);
          return;
        }
        const err: NodeJS.ErrnoException = new Error('EIO: i/o error during restore') as NodeJS.ErrnoException;
        err.code = 'EIO';
        throw err;
      }
      writeFileSync(p, data, encoding as BufferEncoding);
    };

    const result: RewriteResult = rewriteRobotsHandlerWithOptions(dir, {
      allowlist: null,
      verify: () => false,
      writeFile: stubWrite,
    });

    expect(result.status).toBe('failed');
    expect(result.reason).toBe('verify_failed_restore_failed');
    expect(typeof result.error).toBe('string');
    expect(existsSync(join(dir, 'src/server/seo-host.ts'))).toBe(false);
    expect(entryWrites).toBe(2);
  });

  it('non-git-repo dir is treated as dirty (isPathDirty catch fallback)', () => {
    const nonRepo: string = mkdtempSync(join(tmpdir(), 'rewrite-non-repo-'));
    mkdirSync(join(nonRepo, 'src/server'), { recursive: true });
    writeFileSync(join(nonRepo, 'src/server/entry.ts'), fileWith(SHAPE_A_PRE_RUBICON_373), 'utf8');

    const result: RewriteResult = rewriteRobotsHandlerWithOptions(nonRepo, NO_GATE);
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('entry_ts_dirty');

    rmSync(nonRepo, { recursive: true, force: true });
  });
});

describe('insertImportAfterLast (no-imports branch)', () => {
  it('prepends the import when the source has zero import declarations', () => {
    const noImports: string = `function baseUrl(req) { return ""; }
const seoRoutes = [];
function escapeXml(s) { return s; }
const app = { get: () => {} };
${SHAPE_A_PRE_RUBICON_373}
`;
    const result: { status: string; source?: string; addedImport?: boolean } = rewriteEntryTsAny(noImports);
    expect(result.status).toBe('rewritten');
    expect(result.addedImport).toBe(true);
    expect(result.source!.startsWith('import { isSystemHost } from "./seo-host";\n')).toBe(true);
  });
});
