---
name: blog
description: Install and activate the blog system (routes, pages, components)
---

# Blog System Setup Skill

**Purpose:** Install and activate the blog system (routes, pages, components) in an application.

**This skill is ONLY for setting up the blog system. For creating blog post content, use the `blog-writing` skill.**

---

## When to Use This Skill

**User says:**

- "Add a blog"
- "Add a blog section"
- "Create a blog"
- "Set up a blog"
- "I want a blog feature"

**What this skill does:**

- ✅ Installs blog templates (components, pages, utilities)
- ✅ Adds blog routes to routing system
- ✅ Adds blog navigation links
- ✅ Sets up empty blog content directory

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
2. ✅ Add import to `/src/main.tsx`
3. ✅ Add blog routes to `/src/routes.tsx`
4. ✅ Add blog link to navigation in `/src/App.tsx`
5. ✅ Customize BlogHero to match site brand
6. ❌ **DO NOT create any blog post files**
7. ❌ **DO NOT create sample content**
8. ❌ **DO NOT write blog articles**

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
  - `content/*` → `src/content/blog/*`

**Template files installed:**

1. **Components:** BlogCard.tsx, BlogGrid.tsx, BlogHero.tsx, BlogPost.tsx
2. **Pages:** Blog.tsx, BlogPostPage.tsx
3. **Utilities:** blog.ts, frontmatter.ts
4. **Content Setup:** index.ts, README.md

**Important:** The install action handles all file copying automatically - you don't need to use fileEdit!

### Step 1: Add Import to `/src/main.tsx`

After copying templates, add the blog content loader import:

```typescript
import './content/blog'; // Initialize blog posts
```

This should be added near the top of the file with other imports.

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

### Step 5: STOP - Confirm to User

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
- ✅ Content directory ready at `/src/content/blog/`
- ✅ All blog components and pages are installed
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

- ✅ Installs blog system templates (components, pages, lib, content setup)
- ✅ Adds blog routes to application
- ✅ Adds blog navigation links
- ✅ Creates empty content directory

**What this skill does NOT do:**

- ❌ Create blog post content
- ❌ Write articles or sample posts
- ❌ Generate blog post markdown files

**Simple workflow:**

1. User: "Add a blog" → Use `blog` skill (this one)
2. User: "Write a blog post" → Use `blog-writing` skill

Clear separation of concerns! 🎯
