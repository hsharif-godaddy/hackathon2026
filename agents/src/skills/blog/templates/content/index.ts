/**
 * Blog Posts Loader
 *
 * Posts are listed in `posts.json` (the manifest: a stable `id`, publish date,
 * status, and `markdownPath`) and their content lives in the referenced markdown
 * files. The manifest `id` is the stable handle a marketing campaign references
 * (simple_campaign_content.contentRefId) — slugs can change, ids should not.
 *
 * Markdown files NOT listed in the manifest are still loaded (their `id` falls
 * back to the slug), so dropping a plain `.md` into this folder keeps working.
 */
import type { BlogPost } from '../../lib/blog';
import { setBlogPosts } from '../../lib/blog';
import { parseFrontmatter } from '../../lib/frontmatter';
import postsManifest from './posts.json';

/** A single entry in posts.json. */
interface PostManifestEntry {
  /** Stable id (`post-<nanoid>`, same format as social post ids) — what a campaign references (contentRefId). */
  id: string;
  /** URL slug; defaults to the markdown filename. */
  slug?: string;
  /** Path to the markdown file, relative to this folder (e.g. "./my-post.md"). */
  markdownPath: string;
  /** ISO 8601 publish date (authoritative for scheduling/reveal). */
  publishedAt?: string;
  /** Lifecycle status. */
  status?: 'published' | 'scheduled' | 'draft';
  /** Optional marketing-campaign association — read by the marketing-campaign system (via posts.json), not used for blog rendering. */
  campaignId?: string;
}

// Import all .md files as raw strings (build-time).
const markdownFiles = import.meta.glob('./*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});

// Normalize a path to a "./name.md" form so manifest entries and glob keys match.
const normalize = (path: string): string =>
  path.startsWith('./') ? path : `./${path.replace(/^\//, '')}`;

const rawByPath = new Map<string, string>(
  Object.entries(markdownFiles).map(([path, content]) => [normalize(path), content as string]),
);

function toPost(entry: Partial<PostManifestEntry> & { markdownPath: string }): BlogPost {
  const raw = rawByPath.get(normalize(entry.markdownPath)) ?? '';
  const { data, content } = parseFrontmatter(raw);
  const slug =
    entry.slug || data.slug || normalize(entry.markdownPath).replace(/^\.\//, '').replace(/\.md$/, '');
  const status = entry.status;

  return {
    id: entry.id ?? slug,
    slug,
    title: data.title,
    excerpt: data.excerpt,
    content,
    author: data.author,
    publishedAt: entry.publishedAt ?? data.publishedAt,
    updatedAt: data.updatedAt,
    category: data.category,
    tags: data.tags,
    featuredImage: data.featuredImage,
    seoTitle: data.seoTitle,
    seoDescription: data.seoDescription,
    // status wins when present (draft = hidden); otherwise fall back to the `published` flag.
    published: status ? status !== 'draft' : (data.published ?? true),
    status,
  } as BlogPost;
}

const manifest = (postsManifest as PostManifestEntry[]) ?? [];
const manifestPaths = new Set(manifest.map((entry) => normalize(entry.markdownPath)));

// Manifest-listed posts carry a stable id and are campaign-referenceable.
const manifestPosts = manifest.map(toPost);

// Fallback: any .md not in the manifest (excluding README) still renders, id = slug.
const fallbackPosts = Object.keys(markdownFiles)
  .map(normalize)
  .filter((path) => !path.includes('README.md') && !manifestPaths.has(path))
  .map((markdownPath) => toPost({ markdownPath }));

const posts: BlogPost[] = [...manifestPosts, ...fallbackPosts];

setBlogPosts(posts);

export { posts };
