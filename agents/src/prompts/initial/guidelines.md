# Planning Guidelines

## Understand the User's Intent

**Before creating the todo list, think about:**

- What is the PURPOSE of this site/app? (marketing site, blog, dashboard, game, portfolio, etc.)
- What PAGES or SECTIONS does it need? (don't just assume "hero + features + CTA")
- What TYPE of content? (posts, products, team bios, stats, etc.)
- What IMAGES make sense? (product screenshots, blog covers, backgrounds, etc.)
- **What requires APIs or database?** (user auth, data storage, forms, dynamic content) - DEFER to phase 2

## What to Include in the Todo List

**CRITICAL: Only build a single-page preview. Defer everything else.**

**Keep it simple - 3-5 todo items maximum:**

1. **Search for images FIRST** - ALWAYS search for images before creating any pages
   - ✅ "Search for [type of images] for homepage"
   - ✅ "Find product images for homepage"
   - ✅ "Search for blog post cover images"
   - This must be a separate step that happens BEFORE building the page
2. **Homepage only** - Build ONLY index.tsx, no other pages
   - ✅ "Build homepage (index.tsx) with post list preview"
   - ✅ "Create dashboard homepage with stats overview"
   - ❌ "Build homepage and post detail pages" (TOO MUCH - only homepage!)
   - ❌ "Create multiple pages" (NO - single page only!)
3. **Add images** - Add the specific images found in step 1
   - ✅ "Add images to homepage"
   - ❌ "Add images to multiple pages" (only homepage!)
4. **Header/Footer** - One todo for both (skip for dashboards/games)
   - "Update header and footer in App.tsx"
5. **Ask about next phase** - Always end by asking about remaining features
   - "Ask user if they want to build: [list of deferred features]"

## Template File Structure

The template has this structure:

```
src/
├── pages/
│   └── index.tsx          # Homepage (currently uses DemoContent)
├── routes.tsx             # Route definitions
├── App.tsx                # App setup with RootLayout config
├── layouts/
│   └── RootLayout.md      # Documentation for header/footer config
└── components/
    └── ui/                # Reusable UI components
```

## Single Page Preview Only

**CRITICAL: Only build index.tsx (homepage) in the initial preview.**

- Edit `index.tsx` to replace DemoContent with homepage content
- DO NOT create additional page files
- DO NOT add routes for other pages
- Defer all additional pages to future phases

## Images

**CRITICAL: Image search must be a separate todo item that happens BEFORE creating the page.**

**Image workflow:**

1. **First todo item: Search for images** - Find appropriate images for the content
2. **Second todo item: Build page** - Create the page structure
3. **Third todo item: Add images** - Add the specific images found in step 1

**Only add image tasks if the content actually needs them.**

Ask yourself: What images make sense for THIS specific site?

- Blog/news site → post cover images
- Portfolio → project screenshots
- Product site → product images
- Restaurant → food photos
- Team page → team member photos

Don't default to "hero background image" unless specifically requested.

## Header/Footer (Conditional)

**Only for public websites** (not dashboards, games, single-page apps):

Single todo item: "Update header and footer in App.tsx"

The develop agent will update:

- headerConfig (logo text, navigation items)
- footerConfig (copyright text)

**Skip for:**

- Dashboards (use Dashboard layout)
- Games
- Apps without traditional navigation
- Single-page apps

## Final Step

The last todo should ask the user if they want to build remaining features:

"Ask user if they want to build: [list specific deferred features like 'about page', 'contact page', 'blog post detail pages', etc.]"

This allows the user to review the preview before committing to building additional features.

## Preview Guidelines

**Good Single-Page Previews:**

- **Homepage only** - Build index.tsx, defer all other pages
- Match the user's actual request (don't assume "hero + features + CTA")
- Focus on the core purpose (blog = post list preview, portfolio = project grid, dashboard = stats)
- Include realistic content types (not generic placeholders)
- Show enough to demonstrate the concept, but stay on one page

**Avoid in Initial Preview:**

- Multiple pages (defer to future phases)
- **Any feature requiring APIs or database** (defer to future phases):
  - Login/authentication forms
  - Contact forms or data submission
  - User accounts or profiles
  - Dynamic data from databases
  - Shopping carts or checkout
  - Real-time data or integrations
  - File uploads
  - Search functionality with backend
