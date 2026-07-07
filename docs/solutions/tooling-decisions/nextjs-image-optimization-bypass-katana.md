---
title: "Next.js image handling in the Katana/Gasket deployment"
date: 2026-05-28
category: tooling-decisions
module: app
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Rendering next/image in the app/ (website) package"
  - "Adding a committed image asset that must show in production"
  - "Debugging a broken image that works locally but not in Katana/Gasket"
related_components:
  - development_workflow
tags:
  - next-image
  - katana-deployment
  - gasket
  - webpack-static-import
  - gitignore
  - unoptimized
  - asset-bundling
---

# Next.js image handling in the Katana/Gasket deployment

## Context

The empty-state image on `/apps` rendered fine in local dev but was broken in Katana/Gasket production. The code used `<Image src="/images/empty-projects.png" />`, relying on two standard Next.js conventions that do not hold in the Gasket deployment:

1. The image optimization endpoint `/_next/image?url=...` exists and transforms images.
2. The `public/` directory is served at `/`.

The durable lesson holds: the app runs behind Gasket's plugin-based HTTPS proxy with custom routing, not a stock `next start` server, so `next/image` requests routed through the `/_next/image` optimizer 404. The `public/` path, however, IS served — the original break was the missing `unoptimized` flag, not the path. Any `next/image` usage (logos, icons, illustrations, empty-state art) hits this.

## Guidance

`next/image` in the `app/` package needs `unoptimized` because the optimizer endpoint is never available in Katana/Gasket. Once `unoptimized` is set, a `public/` path works.

**Committed asset (ships in the repo):** public path + `unoptimized`.

```tsx
// Before (broken in Katana/Gasket prod -- optimizer 404)
<Image src="/images/empty-projects.png" alt="" width={192} height={192} />

// After (works in every deployment)
<Image src="/images/empty-projects.png" alt="" width={192} height={192} unoptimized />
```

A static webpack import (`import img from '@/assets/images/...'`) also works with `unoptimized`, but the team reverted that migration (PR #4303, commit 57333a775) back to the public path. `app/src/assets/` no longer exists. Either approach needs `unoptimized`; the public path is the current convention.

**Runtime / agent-generated media (URL from API or manifest):** pass the URL string + `unoptimized`. The brand-book component already does this for logos resolved at runtime (`app/src/app/[market]/develop/components/preview/brand-book/sections.tsx`):

```tsx
<Image src={logoUrl} alt="Logo on light background" width={0} height={0}
  sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
```

Static import is impossible here because the URL is not known at build time; `unoptimized` is still required.

**Build-context gotcha — `.gitignore` negation.** The root `.gitignore` has a global `*.png` rule for Playwright artifacts. It also drops committed PNGs from the Docker build context, so the file is missing from the image and the build fails. Re-include committed assets with a negation placed *after* the `*.png` line:

```gitignore
*.png
!blog/public/images/*.png
!docs/**/*.png
!app/public/images/*.png
```

## Why This Matters

The pattern that works in `next dev` (optimizer present) silently breaks in Katana/Gasket without `unoptimized`, and the failure only shows in deployed environments, not in local dev or unit tests. Public path + `unoptimized` is deployment-agnostic: it works in Gasket, standalone Next.js, and Vercel alike. The `.gitignore` negation is easy to miss because the file is tracked and serves locally; it only goes missing inside the Docker build context, turning a one-line image change into a build break.

## When to Apply

- **Public path + `unoptimized`** — committed assets (logos, icons, empty-state art). Current convention.
- **URL string + `unoptimized`** — runtime/agent-generated/user-uploaded media whose URL is not known at build time.
- Both cases need `unoptimized` in this codebase because Gasket is the production target and the optimizer is never available. (Outside this codebase, on a host where `/_next/image` works and you want WebP/srcset/quality tuning, the optimizer is preferable.)

## Examples

Checklist for a committed image asset:

1. Place the file at `app/public/images/<name>.png`.
2. Reference it as `src="/images/<name>.png"`.
3. Add `unoptimized` to the `<Image>`.
4. Confirm `.gitignore` has `!app/public/images/*.png` after the `*.png` line, so the asset survives the Docker build context.

A static webpack import from `app/src/assets/` is an alternative, but the team reverted that approach (PR #4303); use the public path.

## Related

- `app/src/app/[market]/apps/page.tsx:208` — empty-state image: public path `/images/empty-projects.png` + `unoptimized` (current).
- `app/src/app/[market]/develop/components/preview/brand-book/sections.tsx` — runtime-URL + `unoptimized` precedent.
- PR #4153 (original change), PR #4303 / commit 57333a775 (revert of the static-import migration back to public path).
- `docs/solutions/developer-experience/gasket-nextjs-local-testing-constraints-2026-03-31.md` — other Gasket/Next.js conventions that behave differently in local vs deployed environments.
