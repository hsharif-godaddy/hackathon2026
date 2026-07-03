import path from 'node:path';

import type { SiteFavicon } from '../../types/rebuild.js';

/** Workspace-relative path of the favicon the stock index.html `<link rel="icon">` points at. */
export const PUBLIC_FAVICON_PATH: string = 'public/favicon.ico';
/** Workspace-relative path of the scaffolded HTML shell carrying the static favicon `<link>`. */
export const INDEX_HTML_PATH: string = 'index.html';

const EXT_TO_MIME: Readonly<Record<string, string>> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

// A favicon mimeType ends up inside an HTML attribute, and `favicon.mimeType`
// originates from the scraped source site — so only accept the narrow shape of
// a real image MIME type and reject anything that could break out of the
// attribute. Unrecognized values fall back to the downloaded file's extension.
const SAFE_IMAGE_MIME_RE: RegExp = /^image\/[a-z0-9.+-]+$/i;

/**
 * Resolve the MIME type to declare for the self-hosted favicon: the source's
 * own `mimeType` when it's a well-formed image type, else inferred from the
 * downloaded asset's extension, else null (caller leaves the link untouched).
 */
export function faviconMimeType(favicon: Pick<SiteFavicon, 'mimeType'>, localPath: string): string | null {
  if (favicon.mimeType && SAFE_IMAGE_MIME_RE.test(favicon.mimeType)) return favicon.mimeType.toLowerCase();
  const ext: string = path.extname(localPath).toLowerCase();
  return EXT_TO_MIME[ext] ?? null;
}

const FAVICON_LINK_RE: RegExp = /<link\b[^>]*\brel=["']icon["'][^>]*>/i;
const TYPE_ATTR_RE: RegExp = /\btype=["'][^"']*["']/i;

/**
 * Set the `type` attribute of the `/favicon.ico` `<link rel="icon">` to
 * `mimeType` so the declared type matches the bytes we self-hosted. The stock
 * template omits `type` — this adds it. No-op when there's no such link or the
 * type already matches.
 */
export function setFaviconLinkType(html: string, mimeType: string): string {
  const match: RegExpMatchArray | null = html.match(FAVICON_LINK_RE);
  if (!match) return html;

  const tag: string = match[0];
  if (!/href=["']\/favicon\.ico["']/i.test(tag)) return html;

  const newTag: string = TYPE_ATTR_RE.test(tag)
    ? tag.replace(TYPE_ATTR_RE, `type="${mimeType}"`)
    : tag.replace(/(\brel=["']icon["'])/i, `$1 type="${mimeType}"`);

  if (newTag === tag) return html;
  return html.replace(tag, newTag);
}

export interface FaviconSelfHostDeps {
  /** Chosen primary site favicon from the scrape, if any. */
  favicon: SiteFavicon | undefined;
  /** Downloaded asset manifest entries (url → on-disk localPath, relative to appPath). */
  assets: ReadonlyArray<{ url: string; localPath: string }>;
  /** Customer-app root the asset localPaths are relative to. */
  appPath: string;
  /** Reads an absolute path to bytes (node:fs for the agent-local .source-site scrape dir). */
  readFaviconBytes: (absPath: string) => Promise<Buffer>;
  /** Reads a customer-workspace text file, or null if absent (workspace API, never raw fs). */
  readWorkspaceText: (workspaceRelPath: string) => Promise<string | null>;
  /** Writes a customer-workspace file (workspace API, never raw fs). */
  writeWorkspaceFile: (workspaceRelPath: string, content: string, encoding: 'utf-8' | 'base64') => Promise<void>;
}

export interface FaviconSelfHostResult {
  faviconWritten: boolean;
  linkTypeUpdated: boolean;
  reason: 'no_favicon' | 'no_local_asset' | 'written';
}

/**
 * Overwrite the template's placeholder `public/favicon.ico` with the cloned
 * site's actual favicon so the stock `<link rel="icon" href="/favicon.ico">`
 * serves it — deterministically, without relying on the agent placing a
 * `<link>` (which it wires as the source's `rel`, often `apple-touch-icon`, so
 * the browser tab never gets it). Writing the committed root file also lets the
 * favicon survive the dist-only publish archive. Also corrects the `<link>`'s
 * `type` to match the favicon's real format.
 *
 * Only self-hosts when the favicon was actually downloaded; a hotlink-only
 * favicon (e.g. Atlas's synthesized implicit `/favicon.ico`) has no local bytes
 * to copy, so the placeholder is left in place.
 */
export async function selfHostFavicon(deps: FaviconSelfHostDeps): Promise<FaviconSelfHostResult> {
  const { favicon, assets, appPath, readFaviconBytes, readWorkspaceText, writeWorkspaceFile } = deps;

  if (!favicon) return { faviconWritten: false, linkTypeUpdated: false, reason: 'no_favicon' };

  const match: { url: string; localPath: string } | undefined = assets.find(a => a.url === favicon.url);
  if (!match) return { faviconWritten: false, linkTypeUpdated: false, reason: 'no_local_asset' };

  const bytes: Buffer = await readFaviconBytes(path.join(appPath, match.localPath));
  await writeWorkspaceFile(PUBLIC_FAVICON_PATH, bytes.toString('base64'), 'base64');

  const linkTypeUpdated: boolean = await updateFaviconLinkType(favicon, match.localPath, readWorkspaceText, writeWorkspaceFile);
  return { faviconWritten: true, linkTypeUpdated, reason: 'written' };
}

async function updateFaviconLinkType(
  favicon: SiteFavicon,
  localPath: string,
  readWorkspaceText: FaviconSelfHostDeps['readWorkspaceText'],
  writeWorkspaceFile: FaviconSelfHostDeps['writeWorkspaceFile'],
): Promise<boolean> {
  const mimeType: string | null = faviconMimeType(favicon, localPath);
  if (!mimeType) return false;

  const html: string | null = await readWorkspaceText(INDEX_HTML_PATH);
  if (html === null) return false;

  const updated: string = setFaviconLinkType(html, mimeType);
  if (updated === html) return false;

  await writeWorkspaceFile(INDEX_HTML_PATH, updated, 'utf-8');
  return true;
}
