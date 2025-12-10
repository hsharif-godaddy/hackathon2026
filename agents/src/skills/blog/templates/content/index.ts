/**
 * Blog Posts Loader
 *
 * Dynamically loads all .md files from this directory
 * Parses frontmatter and content on the fly - no build step needed!
 */
import type { BlogPost } from '../../lib/blog';
import { setBlogPosts } from '../../lib/blog';
import { parseFrontmatter } from '../../lib/frontmatter';

// Import all .md files as raw strings
const markdownFiles = import.meta.glob('./*.md', {
  eager: true,
  query: '?raw',
  import: 'default'
});

// Parse markdown files into blog posts (exclude README.md)
const posts: BlogPost[] = Object.entries(markdownFiles)
  .filter(([filepath]) => !filepath.includes('README.md'))
  .map(([filepath, content]) => {
    const { data, content: markdownContent } = parseFrontmatter(content as string);

    // Extract slug from filename
    const slug = filepath.replace('./', '').replace('.md', '');

    return {
      slug: data.slug || slug,
      title: data.title,
      excerpt: data.excerpt,
      content: markdownContent,
      author: data.author,
      publishedAt: data.publishedAt,
      updatedAt: data.updatedAt,
      category: data.category,
      tags: data.tags,
      featuredImage: data.featuredImage,
      seoTitle: data.seoTitle,
      seoDescription: data.seoDescription,
      published: data.published ?? true,
    } as BlogPost;
  });

setBlogPosts(posts);

export { posts };
