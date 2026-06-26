/**
 * RSS Feed Handler
 *
 * Generates W3C-valid RSS 2.0 XML from blog post markdown files.
 * Content is embedded at build time via import.meta.glob — no runtime
 * filesystem access, works correctly in Vite SSR bundles.
 *
 * Installed into customer apps at src/server/rss.ts.
 */

import type { Request, RequestHandler, Response } from "express";
import type { ParsedMarkdown } from "../lib/frontmatter";
import { parseFrontmatter } from "../lib/frontmatter";

const FEED_TITLE: string = "Feed";
const FEED_DESCRIPTION: string = "Latest blog posts";
const FEED_LANGUAGE: string = "en";
const MAX_ITEMS: number = 100;

interface ContentFrontmatter {
  title?: string;
  excerpt?: string;
  slug?: string;
  published?: boolean | string;
  publishedAt?: string;
}

// Embedded at build time by Vite. Resolves relative to the installed
// location (src/server/rss.ts → src/content/data/blog/*.md).
const markdownFiles: Record<string, string> = import.meta.glob(
  "../content/data/blog/*.md",
  { eager: true, query: "?raw", import: "default" }
);

export interface PostMeta {
  title: string;
  excerpt: string;
  slug: string;
  publishedAt: string;
}

const XML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c: string): string => XML_ESCAPE_MAP[c]!);
}

function siteOrigin(req: Request): string {
  const env: string | undefined = process.env.PUBLIC_URL || process.env.SITE_URL;
  if (env) return env.replace(/\/+$/, "");
  return `${req.protocol}://${req.hostname}`;
}

function isFutureDate(date: Date, now: Date): boolean {
  return date > now;
}

function loadPosts(rawFiles: Record<string, string>): PostMeta[] {
  const now: Date = new Date();
  const posts: PostMeta[] = [];

  for (const [filepath, raw] of Object.entries(rawFiles)) {
    const parsed: ParsedMarkdown = parseFrontmatter(raw);
    const data: ContentFrontmatter = parsed.data as ContentFrontmatter;

    const published: boolean | string | undefined = data.published ?? true;
    if (!published) continue;

    const publishedAt: string = String(data.publishedAt || "");
    if (!publishedAt) continue;

    const pubDate: Date = new Date(publishedAt);
    if (Number.isNaN(pubDate.getTime())) continue;
    if (isFutureDate(pubDate, now)) continue;

    const filename: string = filepath.split("/").pop() || filepath;
    const slug: string = String(data.slug || "") || filename.replace(/\.md$/, "");

    posts.push({
      title: String(data.title || ""),
      excerpt: String(data.excerpt || ""),
      slug,
      publishedAt,
    });
  }

  posts.sort(
    (a: PostMeta, b: PostMeta): number =>
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );

  return posts.slice(0, MAX_ITEMS);
}

function buildFeedXml(
  posts: PostMeta[],
  origin: string,
  feedTitle: string,
  feedDescription: string
): string {
  const lastBuildDate: string =
    posts.length > 0
      ? new Date(posts[0].publishedAt).toUTCString()
      : new Date().toUTCString();

  const items: string = posts
    .map((post: PostMeta): string => {
      const link: string = `${origin}/blog/${post.slug}`;
      return [
        "    <item>",
        `      <title>${escapeXml(post.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <description>${escapeXml(post.excerpt)}</description>`,
        `      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const selfLink: string = `${origin}/feed.xml`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(feedTitle)}</title>`,
    `    <link>${escapeXml(origin)}</link>`,
    `    <description>${escapeXml(feedDescription)}</description>`,
    `    <language>${FEED_LANGUAGE}</language>`,
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(selfLink)}" rel="self" type="application/rss+xml"/>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/**
 * Create an RSS handler with the given content map.
 * Defaults to build-time embedded blog content via import.meta.glob.
 * Accepts explicit content for testing.
 */
export function createRssHandler(
  content: Record<string, string> = markdownFiles
): RequestHandler {
  return (req: Request, res: Response): void => {
    try {
      const origin: string = siteOrigin(req);
      const posts: PostMeta[] = loadPosts(content);
      const xml: string = buildFeedXml(posts, origin, FEED_TITLE, FEED_DESCRIPTION);

      res
        .set("Content-Type", "application/rss+xml; charset=utf-8")
        .set("Cache-Control", "public, max-age=3600")
        .send(xml);
    } catch (err: unknown) {
      console.error("rss.feed.failed", {
        url: req.originalUrl,
        error: err instanceof Error ? err.stack : String(err),
      });
      res.status(500).set("Content-Type", "application/rss+xml; charset=utf-8").send(
        '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Error</title></channel></rss>'
      );
    }
  };
}

export const rssHandler: RequestHandler = createRssHandler();
