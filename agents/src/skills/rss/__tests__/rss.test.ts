import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../lib/frontmatter", async () => {
  return await vi.importActual("../../blog/templates/lib/frontmatter");
});

const { createRssHandler } = await import("../templates/server/rss.js");

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    protocol: "https",
    hostname: "example.com",
    originalUrl: "/feed.xml",
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response & {
  _headers: Record<string, string>;
  _body: string;
  _status: number;
} {
  const res = {
    _headers: {} as Record<string, string>,
    _body: "",
    _status: 200,
    set(key: string, value: string) {
      res._headers[key] = value;
      return res;
    },
    status(code: number) {
      res._status = code;
      return res;
    },
    send(body: string) {
      res._body = body;
      return res;
    },
  };
  return res as unknown as Response & {
    _headers: Record<string, string>;
    _body: string;
    _status: number;
  };
}

function makePost(overrides: Record<string, string | boolean> = {}): string {
  const fields: Record<string, string | boolean> = {
    title: "Test Post",
    excerpt: "A test post",
    published: true,
    publishedAt: "2024-03-01",
    slug: "test-post",
    ...overrides,
  };
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("---", "Post content.");
  return lines.join("\n");
}

describe("rssHandler", () => {
  beforeEach(() => {
    delete process.env.PUBLIC_URL;
    delete process.env.SITE_URL;
  });

  it("returns valid RSS with no items when content map is empty", () => {
    const handler = createRssHandler({});
    const req = createMockRequest();
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    expect(res._headers["Content-Type"]).toBe(
      "application/rss+xml; charset=utf-8"
    );
    expect(res._headers["Cache-Control"]).toBe("public, max-age=3600");
    expect(res._body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(res._body).toContain('<rss version="2.0"');
    expect(res._body).toContain("xmlns:atom");
    expect(res._body).toContain("<channel>");
    expect(res._body).toContain("<title>Feed</title>");
    expect(res._body).toContain("</channel>");
    expect(res._body).not.toContain("<item>");
  });

  it("generates correct items sorted newest-first for published posts", () => {
    const content: Record<string, string> = {
      "../content/blog/older-post.md": makePost({
        title: "Older Post",
        excerpt: "An older post",
        publishedAt: "2024-01-01",
        slug: "older-post",
      }),
      "../content/blog/newer-post.md": makePost({
        title: "Newer Post",
        excerpt: "A newer post",
        publishedAt: "2024-06-15",
        slug: "newer-post",
      }),
    };
    const handler = createRssHandler(content);
    const req = createMockRequest();
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    expect(res._body).toContain("<item>");
    const newerIndex = res._body.indexOf("<title>Newer Post</title>");
    const olderIndex = res._body.indexOf("<title>Older Post</title>");
    expect(newerIndex).toBeLessThan(olderIndex);
    expect(res._body).toContain(
      "<link>https://example.com/blog/newer-post</link>"
    );
    expect(res._body).toContain(
      "<link>https://example.com/blog/older-post</link>"
    );
    expect(res._body).toContain(
      "<description>A newer post</description>"
    );
  });

  it("excludes draft posts with published: false", () => {
    const content: Record<string, string> = {
      "../content/blog/published-post.md": makePost({
        title: "Published Post",
        excerpt: "A published post",
        published: true,
        publishedAt: "2024-03-01",
        slug: "published-post",
      }),
      "../content/blog/draft-post.md": makePost({
        title: "Draft Post",
        excerpt: "A draft",
        published: false,
        publishedAt: "2024-03-01",
        slug: "draft-post",
      }),
    };
    const handler = createRssHandler(content);
    const req = createMockRequest();
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    expect(res._body).toContain("<title>Published Post</title>");
    expect(res._body).not.toContain("<title>Draft Post</title>");
  });

  it("includes posts with missing published field (defaults to true)", () => {
    const content: Record<string, string> = {
      "../content/blog/no-published-field.md": [
        "---",
        "title: No Published Field",
        "excerpt: Missing published key",
        "publishedAt: 2024-04-01",
        "slug: no-published-field",
        "---",
        "Content.",
      ].join("\n"),
    };
    const handler = createRssHandler(content);
    const req = createMockRequest();
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    expect(res._body).toContain("<title>No Published Field</title>");
  });

  it("excludes future-dated posts", () => {
    const content: Record<string, string> = {
      "../content/blog/past-post.md": makePost({
        title: "Past Post",
        excerpt: "Already published",
        publishedAt: "2024-01-15",
        slug: "past-post",
      }),
      "../content/blog/future-post.md": makePost({
        title: "Future Post",
        excerpt: "Coming soon",
        publishedAt: "2099-12-31",
        slug: "future-post",
      }),
    };
    const handler = createRssHandler(content);
    const req = createMockRequest();
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    expect(res._body).toContain("<title>Past Post</title>");
    expect(res._body).not.toContain("<title>Future Post</title>");
  });

  it("excludes posts with invalid publishedAt dates", () => {
    const content: Record<string, string> = {
      "../content/blog/valid-post.md": makePost({
        title: "Valid Post",
        excerpt: "Has a real date",
        publishedAt: "2024-05-01",
        slug: "valid-post",
      }),
      "../content/blog/invalid-date.md": makePost({
        title: "Invalid Date Post",
        excerpt: "Not a date",
        publishedAt: "not-a-date",
        slug: "invalid-date",
      }),
    };
    const handler = createRssHandler(content);
    const req = createMockRequest();
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    expect(res._body).toContain("<title>Valid Post</title>");
    expect(res._body).not.toContain("<title>Invalid Date Post</title>");
    expect(res._body).not.toContain("Invalid Date");
  });

  it("escapes special XML characters in content", () => {
    const content: Record<string, string> = {
      "../content/blog/special-chars.md": [
        "---",
        'title: Tom & Jerry\'s "Great" <Adventure>',
        "excerpt: A post with & < > symbols",
        "published: true",
        "publishedAt: 2024-05-01",
        "slug: special-chars",
        "---",
        "Content with special chars.",
      ].join("\n"),
    };
    const handler = createRssHandler(content);
    const req = createMockRequest();
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    expect(res._body).toContain("&amp;");
    expect(res._body).toContain("&lt;");
    expect(res._body).toContain("&gt;");
    expect(res._body).toContain("&quot;");
    expect(res._body).toContain("&apos;");
    const itemSection = res._body.slice(
      res._body.indexOf("<item>"),
      res._body.lastIndexOf("</item>") + 7
    );
    expect(itemSection).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
    expect(res._body).toContain(
      "Tom &amp; Jerry&apos;s &quot;Great&quot; &lt;Adventure&gt;"
    );
  });

  it("limits output to 100 most recent posts", () => {
    const content: Record<string, string> = {};
    for (let i = 0; i < 105; i++) {
      const date = new Date(2024, 0, i + 1).toISOString().split("T")[0];
      content[`../content/blog/post-${i}.md`] = makePost({
        title: `Post ${i}`,
        excerpt: `Excerpt ${i}`,
        publishedAt: date,
        slug: `post-${i}`,
      });
    }
    const handler = createRssHandler(content);
    const req = createMockRequest();
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    const itemCount = (res._body.match(/<item>/g) || []).length;
    expect(itemCount).toBe(100);
    expect(res._body).not.toContain("<title>Post 0</title>");
    expect(res._body).not.toContain("<title>Post 4</title>");
    expect(res._body).toContain("<title>Post 104</title>");
  });

  it("uses PUBLIC_URL env var for base URL when set", () => {
    process.env.PUBLIC_URL = "https://my-custom-domain.com";

    const content: Record<string, string> = {
      "../content/blog/test-post.md": makePost({
        title: "Test Post",
        excerpt: "A test",
        publishedAt: "2024-04-01",
        slug: "test-post",
      }),
    };
    const handler = createRssHandler(content);
    const req = createMockRequest({ protocol: "http", hostname: "localhost" });
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    expect(res._body).toContain("https://my-custom-domain.com/blog/test-post");
    expect(res._body).toContain(
      '<atom:link href="https://my-custom-domain.com/feed.xml"'
    );
    expect(res._body).not.toContain("localhost");
  });

  it("derives slug from filename when frontmatter slug is missing", () => {
    const content: Record<string, string> = {
      "../content/blog/my-great-article.md": [
        "---",
        "title: My Great Article",
        "excerpt: No slug field here",
        "published: true",
        "publishedAt: 2024-07-01",
        "---",
        "Article content.",
      ].join("\n"),
    };
    const handler = createRssHandler(content);
    const req = createMockRequest();
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    expect(res._body).toContain(
      "<link>https://example.com/blog/my-great-article</link>"
    );
  });

  it("returns 500 with error XML when handler throws", () => {
    const badContent = new Proxy(
      {},
      {
        get() {
          throw new Error("simulated failure");
        },
        ownKeys() {
          throw new Error("simulated failure");
        },
        getOwnPropertyDescriptor() {
          throw new Error("simulated failure");
        },
      }
    ) as Record<string, string>;

    const handler = createRssHandler(badContent);
    const req = createMockRequest();
    const res = createMockResponse();

    handler(req, res as unknown as Response);

    expect(res._status).toBe(500);
    expect(res._headers["Content-Type"]).toBe(
      "application/rss+xml; charset=utf-8"
    );
    expect(res._body).toContain("<title>Error</title>");
  });
});
