# Blog Posts

This directory contains blog post content for your site.

**Your blog starts empty.** Posts will be created here when you ask the AI agent to write blog content.

## How Blog Posts Work

Blog posts are stored as **Markdown files** (`.md`) with frontmatter (YAML metadata at the top). This provides:

- Native markdown editing experience
- Clean separation of metadata and content
- Better readability and maintainability
- Standard format used by most blog systems
- **Automatic loading** - no manual registration needed!

## Creating a Blog Post

Create a new file in this directory (e.g., `my-first-post.md`) with the following structure:

```markdown
---
title: 'My First Blog Post'
excerpt: 'A brief description that hooks the reader'
author: 'Your Name'
publishedAt: '2025-01-15T10:00:00Z'
category: 'General'
tags: ['tutorial', 'getting-started']
featuredImage: '/images/blog/my-first-post.jpg'
seoTitle: 'My First Blog Post | My Site'
seoDescription: 'Learn about creating your first blog post'
published: true
---

# My First Post

This is the full content of the blog post. You can use **markdown** formatting naturally!

## Why This Matters

Connect with your reader's goal or pain point. Use "you" language to make it personal.

- **Key benefit #1**: Explain the value
- **Key benefit #2**: Make it tangible
- **Key benefit #3**: Show the outcome

## Main Content

Break content into digestible chunks. Keep paragraphs short (2-4 sentences).

### Subsection

Give readers actionable information:

1. **First step**: Clear instruction
2. **Second step**: What to do next
3. **Third step**: Expected result

> **Pro Tip**: Use blockquotes for important callouts and expert advice.

## Key Takeaways

- First major insight
- Second important lesson
- Third actionable takeaway

## Conclusion

End with a clear next step. Make readers feel empowered!
```

## Frontmatter Properties

**Required:**

- **title**: Post title displayed on the page
- **excerpt**: Short description (160 chars max recommended)
- **publishedAt**: Publication date (ISO 8601 format: `"2025-01-15T10:00:00Z"`)
- **published**: Whether post is live (`true`) or draft (`false`)

**Optional:**

- **author**: Author name
- **updatedAt**: Last updated date (ISO 8601 format)
- **category**: Post category for filtering
- **tags**: Array of tags for filtering (e.g., `["tutorial", "beginner"]`)
- **featuredImage**: Featured image URL or path (highly recommended!)
- **seoTitle**: SEO-optimized title (60 chars max recommended)
- **seoDescription**: SEO meta description (160 chars max recommended)

**Note**: The filename becomes the slug (e.g., `my-first-post.md` → `/blog/my-first-post`)

## Automatic Loading

Posts are **loaded on the fly** - no build step needed!

How it works:

1. Vite's `import.meta.glob` loads all `.md` files as raw strings
2. Lightweight frontmatter parser extracts YAML metadata
3. react-markdown renders the content
4. Everything happens automatically when you import the blog index

Just create a `.md` file and it's instantly available - no restart needed!

## Content Writing Tips

- **Keep paragraphs short** (2-4 sentences)
- **Use headings** to break up content (##, ###)
- **Add lists** every few paragraphs for scannability
- **Bold key terms** for emphasis
- **Use blockquotes** (>) for tips and callouts
- **Include code blocks** with proper language tags
- **Add images** inline with `![alt text](image-path)`
- **Write conversationally** - address readers directly

## Getting Started

Your site has a complete blog system built-in, but it starts with no posts. To get started:

1. **Activate the blog**: Ask the AI agent "Add a blog to my site" (adds navigation link)
2. **Create your first post**: Ask "Create a blog post about [topic]"

## Getting Help

Ask the AI agent to:

- "Add a blog to my site" - Adds blog link to navigation
- "Create a blog post about [topic]" - Writes and publishes a new post
- "Write 5 blog posts about [topics]" - Creates multiple posts at once
- "Update the blog post about [topic]" - Edits an existing post
