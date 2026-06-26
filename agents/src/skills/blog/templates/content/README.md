# Blog Posts

This directory is a placeholder. Your blog posts live elsewhere — see below.

## Where posts live

Posts are stored at `src/content/data/blog/<slug>.{md,json}`.

Each file is self-describing: the filename becomes the slug for routing, and the file
carries a stable `id` field (format: `post-<nanoid>`) used by marketing campaigns to
reference a specific post regardless of slug changes.

Example markdown post (`src/content/data/blog/my-first-post.md`):

```markdown
---
id: post-abc123
slug: my-first-post
title: 'My First Post'
excerpt: 'A brief description'
featuredImage: 'https://media.gettyimages.com/id/1234567/photo/example.jpg'
publishedAt: '2025-01-15T10:00:00Z'
published: true
---

Full post body in markdown.
```

Example JSON post (`src/content/data/blog/my-first-post.json`):

```json
{
  "id": "post-abc123",
  "slug": "my-first-post",
  "title": "My First Post",
  "excerpt": "A brief description",
  "featuredImage": "https://media.gettyimages.com/id/1234567/photo/example.jpg",
  "publishedAt": "2025-01-15T10:00:00Z",
  "published": true,
  "content": "Full post body."
}
```

## How posts are consumed

Posts are consumed via `virtual:content`, a Vite virtual module provided by the
airo-content plugin at build time. `lib/blog.ts` reads `content.blog` — an array of
all posts sorted by filename — and exposes getter utilities (`getBlogPosts`,
`getPostBySlug`, etc.) to the rest of the blog UI.

There is **no `posts.json` manifest** and no separate glob loader. The plugin discovers
every `.md` and `.json` file under `src/content/data/blog/` automatically.

## Frontmatter fields

**Required:**

- `id` — stable `post-<nanoid>` identifier (stays constant even if slug changes)
- `title` — post title
- `excerpt` — short description (160 chars max recommended)
- `publishedAt` — ISO 8601 publication date
- `published` — `true` for live, `false` for draft

**Recommended:**

- `featuredImage` — image URL (the blog-writing flow supplies a Getty URL). Rendered as the
  post's card image and hero; a post without it falls back to a blank/placeholder, so the
  authoring flow treats it as required even though the schema permits its absence.
- `slug` — defaults to the filename (`my-first-post.md` → `my-first-post`); include only to override.

**Optional:**

- `author`, `updatedAt`, `category`, `tags`
- `seoTitle`, `seoDescription`, `status` (`published | scheduled | draft`)

## Getting started

Ask the AI agent to create posts:

- "Create a blog post about [topic]"
- "Write 5 blog posts about [topics]"
- "Update the blog post about [topic]"
