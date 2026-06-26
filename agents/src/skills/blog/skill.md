---
name: blog
description: Install and activate the blog system (routes, pages, components)
whenToUse: User wants a blog, news section, or articles feature on their site. Phrases like "add a blog", "create a blog", "set up a blog", "I want a blog feature", "news section", "articles page", "post articles", "content section for articles".
intents:
  - set up blog/blog system/news section
---

# Blog System Setup Skill

**Purpose:** Install and activate the blog system (routes, pages, components) in an application.

**This skill is ONLY for setting up the blog system. For creating blog post content, use the `blog-writing` skill.**

> **Note:** This skill provides templates only. Some skills may also provide specialized tools that are automatically loaded when you activate the skill. Tools are prefixed with the skill name (e.g., `skillname__toolname`) to prevent naming conflicts. You can unload a skill's tools with `skill({ action: 'unload', skill: 'name' })` when no longer needed.

---

## When to Use This Skill

**User says:**

- "Add a blog"
- "Add a blog section"
- "Create a blog"
- "Set up a blog"
- "I want a blog feature"
- "Add a news section"
- "Articles page"
- "Post articles on my site"
- "Content section for articles"

**What this skill does:**

- ✅ Installs blog templates (components, pages, utilities)
- ✅ Adds blog routes to routing system
- ✅ Adds blog navigation links
- ✅ Sets up empty blog content directory (`src/content/data/blog/`)
- ✅ Creates or merges `src/content/schemas.ts` with the `blog` collection schema

**What this skill does NOT do:**

- ❌ Create blog posts
- ❌ Write blog content
- ❌ Generate sample articles

**For writing blog posts, use the `blog-writing` skill instead.**

---

## Prerequisites

- Application must be using React + React Router
- Must have a routing system (`/src/routes.tsx` or similar)
- Must have navigation component (`/src/App.tsx` or similar)

## What "Activating the Blog" Means

User says: **"Create a blog"** or **"Add a blog"**

**Your response:**

1. ✅ Copy blog templates from skill (components, pages, lib, content)
2. ✅ Create `src/content/data/blog/` (empty collection directory)
3. ✅ Create or merge `src/content/schemas.ts` with the `blog` collection schema
4. ✅ Add blog routes to `/src/routes.tsx`
5. ✅ Add blog link to navigation in `/src/App.tsx`
6. ✅ Customize BlogHero to match site brand
7. ❌ **DO NOT create any blog post files**
8. ❌ **DO NOT create sample content**
9. ❌ **DO NOT write blog articles**

Confirm: "Blog activated at `/blog`! It's empty right now - would you like me to create some blog posts?"

---

## Step-by-Step: Activating the Blog

### Step 0: Install Blog Templates (REQUIRED FIRST STEP)

**⚠️ CRITICAL: You MUST install the blog template files before adding routes!**

The blog skill includes production-ready templates that are installed directly using the skill tool:

```typescript
skill({
  action: 'install',
  skill: 'blog',
});
```

**What this does:**

- Directly copies all template files from the skill to the app directory
- No templates pass through LLM context (faster, more reliable, cheaper)
- Automatically maps paths to correct destinations:
  - `components/*.tsx` → `src/components/blog/*.tsx`
  - `pages/*.tsx` → `src/pages/*.tsx`
  - `lib/*.ts` → `src/lib/*.ts`

**Template files installed:**

1. **Components:** BlogCard.tsx, BlogGrid.tsx, BlogHero.tsx, BlogPost.tsx
2. **Pages:** Blog.tsx, BlogPostPage.tsx
3. **Utilities:** blog.ts

**Important:** The install action handles all file copying automatically - you don't need to use str_replace_based_edit_tool!

### Step 1: Create content directory and schema

After installing templates, set up the content collection:

1. Create the empty collection directory: `src/content/data/blog/` (no files yet — posts are added by the `blog-writing` skill)

2. Create or merge `src/content/schemas.ts` to add the `blog` schema. If the file already exists, add the `blogPostSchema` and `blog` entry without overwriting other schemas. Use this exact content:

```ts
// src/content/schemas.ts
import { z } from 'zod';

export const blogPostSchema = z.object({
  id: z.string(),
  slug: z.string().min(1),
  title: z.string(),
  excerpt: z.string(),
  content: z.string(),
  author: z.string().optional(),
  publishedAt: z.string(),
  updatedAt: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  featuredImage: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  published: z.boolean(),
  status: z.enum(['published', 'scheduled', 'draft']).optional(),
});

export const schemas = {
  blog: z.array(blogPostSchema).superRefine((posts, ctx) => {
    const seen = new Set<string>();
    posts.forEach((p, i) => {
      if (seen.has(p.slug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate blog slug "${p.slug}"`, path: [i, 'slug'] });
      }
      seen.add(p.slug);
    });
  }),
};
```

(Slug uniqueness is enforced here in the schema — not in the plugin core.)

### Step 2: Add Routes to `/src/routes.tsx`

**Read the file first**, then add the blog routes:

```typescript
import { RouteObject } from 'react-router-dom';
import { lazy } from 'react';
import HomePage from './pages/index';

const isDevelopment = (import.meta.env as any).DEV;
const NotFoundPage = isDevelopment ? lazy(() => import('../dev-tools/src/PageNotFound')) : lazy(() => import('./pages/_404'));

// ✅ ADD THESE TWO IMPORTS
const BlogPage = lazy(() => import('./pages/Blog'));
const BlogPostPage = lazy(() => import('./pages/BlogPostPage'));

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <HomePage />,
  },
  // ✅ ADD THESE TWO ROUTES
  {
    path: '/blog',
    element: <BlogPage />,
  },
  {
    path: '/blog/:slug',
    element: <BlogPostPage />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
];

// ✅ UPDATE PATH TYPE
export type Path = '/' | '/blog' | `/blog/${string}`;

export type Params = Record<string, string | undefined>;
```

### Step 3: Add Navigation Link to `/src/App.tsx`

Update the `navItems` array in the `headerConfig` object:

```typescript
const headerConfig: RootLayoutConfig['header'] = {
  logo: {
    text: 'App',
    href: '/',
  },
  navItems: [
    { href: '/', label: 'Home' },
    { href: '/blog', label: 'Blog' }, // ✅ ADD THIS
    { href: '/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
  ],
  sticky: true,
};
```

### Step 4: Customize Blog Hero in `/src/pages/Blog.tsx`

**CRITICAL: Make the blog hero match the site's brand and context.**

Read `/src/pages/Blog.tsx` and update the `BlogHero` component with site-appropriate text:

**Examples based on site type:**

**Fitness site (like "FitFlow Studio"):**

```typescript
<BlogHero
  title="Fitness Insights"
  subtitle="Expert tips, workout guides, and wellness advice to help you reach your fitness goals"
  variant="default"
/>
```

**Restaurant site:**

```typescript
<BlogHero
  title="From Our Kitchen"
  subtitle="Recipes, cooking tips, and stories from our culinary team"
  variant="default"
/>
```

**Tech startup:**

```typescript
<BlogHero
  title="Tech Blog"
  subtitle="Product updates, engineering insights, and industry trends"
  variant="default"
/>
```

**E-commerce store:**

```typescript
<BlogHero
  title="Style Guide"
  subtitle="Fashion tips, new arrivals, and styling inspiration"
  variant="default"
/>
```

**Generic/unknown context:**

```typescript
<BlogHero
  title="Our Blog"
  subtitle="Latest updates, insights, and stories"
  variant="default"
/>
```

**How to choose:**

1. Consider the site's purpose and brand
2. Match the tone (professional, casual, energetic, etc.)
3. Make subtitle descriptive and relevant to site content
4. Keep title short (1-3 words)
5. Keep subtitle clear and actionable

### Step 5: Set Up RSS

**Set up an RSS feed automatically.** Load the `rss` skill and follow it via
`skill({ action: "load", skill: "rss" })` (which no-ops if a feed already exists).

### Step 6: STOP - Confirm to User

**🛑 STOP HERE. DO NOT CONTINUE TO CREATE BLOG POSTS. 🛑**

Tell the user:

> "Blog activated! You can view it at `/blog`. It's empty right now - let me know when you want me to create blog posts."

**DO NOT proceed to create blog posts unless explicitly asked.**

**DO NOT create sample posts. DO NOT create placeholder content. DO NOT infer that the user wants posts because you know the site context (e.g., fitness site). STOP HERE.**

---

---

## After Blog Activation

Once the blog system is activated:

- ✅ Blog is accessible at `/blog` route
- ✅ Blog link appears in site navigation
- ✅ Content directory ready at `src/content/data/blog/`
- ✅ `src/content/schemas.ts` contains the `blog` collection schema
- ✅ All blog components and pages are installed
- ✅ RSS feed available at `/feed.xml`
- ⚠️ Blog is currently empty (0 posts)

**Important:** The blog system is now ready, but it has no content yet.

---

## Creating Blog Content (Separate Skill)

**If the user wants to create blog posts:**

Tell them: "Blog system is set up! Would you like me to create some blog posts? If so, let me know what topics to write about."

**When they request post content:**

1. Call: `skill({ action: "list" })` to confirm `blog-writing` skill exists
2. Call: `skill({ action: "load", skill: "blog-writing" })`
3. Follow the blog-writing skill instructions

**DO NOT create blog posts using this skill. This skill is ONLY for system setup.**

---

## Summary

**What this skill does:**

- ✅ Installs blog system templates (components, pages, lib)
- ✅ Creates empty collection directory `src/content/data/blog/`
- ✅ Creates or merges `src/content/schemas.ts` with the `blog` schema
- ✅ Adds blog routes to application
- ✅ Adds blog navigation links

**What this skill does NOT do:**

- ❌ Create blog post content
- ❌ Write articles or sample posts
- ❌ Generate blog post markdown files

**Simple workflow:**

1. User: "Add a blog" → Use `blog` skill (this one)
2. User: "Write a blog post" → Use `blog-writing` skill

Clear separation of concerns! 🎯
