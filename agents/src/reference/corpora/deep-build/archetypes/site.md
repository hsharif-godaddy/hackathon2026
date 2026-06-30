# Site Archetype

Use for marketing sites, portfolios, blogs, landing pages, and restaurant/service sites. Build unit is the **page** — pages are independent and highly parallelizable.

<!-- inject-start -->
Build unit: pages (parallel, independent). Design gate before building.
Phases: interview → design → plan → [media + foundation] → pages (parallel) → polish.
Parallelism: high — pages share no files. 2-4 concurrent builders for page phase.
Verify: files_exist per page, tsc at polish.
Skills load after planning, before build.
<!-- inject-end -->

## Typical DAG

```
interview → brief-review (gate) → [business-details, design] (parallel)
→ showcase → design-approval (gate) → planning → plan-review
→ skill-install → [media, foundation] (parallel)
→ [page-1, page-2, page-3] (parallel) → polish → final-verify
```

## Example step plan

```json
{
  "archetype": "site",
  "northStar": { "goals": ["..."], "audience": "...", "voice": "..." },
  "steps": [
    { "id": "interview", "type": "auto", "title": "Collect project brief via interview", "dependsOn": [], "ownedFiles": ["docs/brief.md"], "verify": [{"kind": "files_exist", "spec": "docs/brief.md"}] },
    { "id": "brief-review", "type": "gate", "title": "User reviews project brief", "dependsOn": ["interview"], "ownedFiles": [], "verify": [], "gate": {"prompt": "I've put together a project brief. Does this capture your vision? Anything to add or change?"} },
    { "id": "business-details", "type": "auto", "title": "Collect business details via interview (contact, hours, services)", "dependsOn": ["brief-review"], "ownedFiles": ["docs/business-details.md"], "verify": [{"kind": "files_exist", "spec": "docs/business-details.md"}] },
    { "id": "design", "type": "auto", "title": "Create design system", "dependsOn": ["brief-review"], "ownedFiles": ["docs/design.md", "src/styles/globals.css"], "verify": [{"kind": "files_exist", "spec": "docs/design.md"}] },
    { "id": "showcase", "type": "auto", "title": "Build design preview showcase", "dependsOn": ["business-details", "design"], "ownedFiles": ["src/components/design-preview/Showcase.tsx", "src/data/brand-data.tsx"], "verify": [{"kind": "files_exist", "spec": "src/components/design-preview/Showcase.tsx"}] },
    { "id": "design-approval", "type": "gate", "title": "User approves design direction", "dependsOn": ["showcase"], "ownedFiles": [], "verify": [], "gate": {"prompt": "Does this design direction feel right? Any colors, fonts, or overall vibe you'd like adjusted?"} },
    { "id": "planning", "type": "auto", "title": "Create implementation plan", "dependsOn": ["design-approval"], "ownedFiles": ["docs/plans/site.md"], "verify": [{"kind": "files_exist", "spec": "docs/plans/site.md"}] },
    { "id": "plan-review", "type": "auto", "title": "Review and refine plan", "dependsOn": ["planning"], "ownedFiles": [], "verify": [] },
    { "id": "skill-install", "type": "auto", "title": "Install required skills", "dependsOn": ["plan-review"], "ownedFiles": [], "verify": [] },
    { "id": "media", "type": "auto", "title": "Source all images from asset inventory", "dependsOn": ["skill-install"], "ownedFiles": [], "verify": [] },
    { "id": "foundation", "type": "auto", "title": "Build foundation (layout, nav, routes)", "dependsOn": ["skill-install"], "ownedFiles": ["src/layouts/MainLayout.tsx", "src/layouts/parts/Header.tsx", "src/layouts/parts/Footer.tsx"], "verify": [{"kind": "files_exist", "spec": "src/layouts/MainLayout.tsx"}] },
    { "id": "page-home", "type": "auto", "title": "Build homepage", "dependsOn": ["foundation", "media"], "ownedFiles": ["src/pages/Home.tsx", "src/data/home.ts"], "verify": [{"kind": "files_exist", "spec": "src/pages/Home.tsx"}] },
    { "id": "page-about", "type": "auto", "title": "Build about page", "dependsOn": ["foundation", "media"], "ownedFiles": ["src/pages/About.tsx", "src/data/about.ts"], "verify": [{"kind": "files_exist", "spec": "src/pages/About.tsx"}] },
    { "id": "page-contact", "type": "auto", "title": "Build contact page", "dependsOn": ["foundation", "media"], "ownedFiles": ["src/pages/Contact.tsx", "src/data/contact.ts"], "verify": [{"kind": "files_exist", "spec": "src/pages/Contact.tsx"}] },
    { "id": "polish", "type": "auto", "title": "SEO, a11y, animations", "dependsOn": ["page-home", "page-about", "page-contact"], "ownedFiles": ["src/components/SEO.tsx"], "verify": [{"kind": "tsc", "spec": ""}] },
    { "id": "final-verify", "type": "auto", "title": "Final verification", "dependsOn": ["polish"], "ownedFiles": [], "verify": [{"kind": "tsc", "spec": ""}] }
  ]
}
```

## DAG structure notes

- `interview` → `brief-review` (gate) → `business-details` — sequential, each depends on the prior
- `design` depends on `brief-review` (not business-details) — runs **in parallel** with `business-details`
- `showcase` depends on BOTH `business-details` AND `design` — needs real content + design tokens
- `design-approval` depends on `showcase` (transitively waits for design)
- Page steps all depend on `foundation` but not on each other — fully parallel

## Build phases

| Phase | Steps | Notes |
|-------|-------|-------|
| 0 | interview, brief-review | Interactive + gate |
| 1 | business-details, design (parallel) | Background agents |
| 2 | showcase, design-approval | Showcase builds; gate pauses |
| 3 | planning, plan-review, skill-install | Sequential |
| 4 | media + foundation (parallel) | Both background |
| 5 | pages (2-4 parallel) | High concurrency |
| 6 | polish, final-verify | Single builder |

## Parallelism rules

- Pages are the primary parallel unit — each page owns its own files
- Group pages that share no files (page data, section components, illustrations)
- Foundation owns shared files (layout, nav, routes) — must complete before pages
- Media runs in parallel with foundation (images don't touch source files)
- 2-4 concurrent page builders is typical; more than 4 risks context overhead

## Common skills

- `blog` — blog listing and post pages
- `commerce` — product catalog, cart
- `online-appointments` — booking UI
- `google-maps` — location embeds
- `google-reviews` — review widgets
- `media-image` — AI image generation
- `seo` — meta tags, sitemap

Skills are installed after planning, before the build phase begins. See `step-planning.md` for installation pattern.

## Verify emphasis

- `files_exist` — for every page and key component
- `route_renders` — for any new routes
- `tsc` — at polish and final-verify
- `manual` — for design approval gates
