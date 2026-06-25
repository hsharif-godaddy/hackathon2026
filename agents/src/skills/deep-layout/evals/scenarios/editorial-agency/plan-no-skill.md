# Formless — Site Implementation Plan

## Overview
A cinematic, type-forward portfolio site for Formless creative studio. Editorial luxury aesthetic with full motion design. Built in React + TypeScript + Tailwind.

---

## Tech Stack & Dependencies

- **Framework:** React 18 + TypeScript + Vite
- **Styling:** Tailwind CSS + CSS custom properties (already configured)
- **Animation:** motion v12 (already installed — import from `"motion/react"`, NOT `"framer-motion"`)
- **Routing:** React Router (already in use)
- **SEO:** @dr.pogodin/react-helmet (already installed — import `{ Helmet } from "@dr.pogodin/react-helmet"`)
- **Forms:** Native controlled form (no library needed)
- **Fonts:** Cormorant Garamond + DM Sans via Google Fonts (already in globals.css)

No additional installs required — all dependencies are already present in `package.json`.

---

## File Structure

```
src/
  components/
    cursor/
      CustomCursor.tsx         # Dot + ring cursor, follows mouse
    layout/
      Nav.tsx                  # Minimal top nav: FORMLESS wordmark left, links right
      Footer.tsx               # Sparse footer: email, socials, copyright
    ui/
      SplitReveal.tsx          # Letter-by-letter scroll-triggered reveal
      FadeIn.tsx               # Scroll-triggered fade + translate-up
      Divider.tsx              # Thin 1px horizontal rule
    home/
      Hero.tsx                 # Full-viewport hero with video loop + wordmark
      WorkPreview.tsx          # 2-up case study teasers on home
      StudioTeaser.tsx         # Brief studio statement section
    work/
      CaseStudyCard.tsx        # Work index card — image + title + category
    case-study/
      CaseStudyHero.tsx        # Full-bleed image + split-reveal title
      CaseStudyBody.tsx        # Narrative text + stills grid
      CaseStudyProcess.tsx     # BTS/process section
    studio/
      StudioHero.tsx           # Studio statement + founding copy
      StudioValues.tsx         # 3-column values/approach
    contact/
      ContactForm.tsx          # Name, email, message form
  data/
    case-studies.ts            # Array of 4 case study objects
    brand-data.tsx             # Already exists
  pages/
    Home.tsx
    Work.tsx
    CaseStudy.tsx              # Dynamic — reads slug from URL
    Studio.tsx
    Contact.tsx
    DesignPreview.tsx          # Already exists
  layouts/
    RootLayout.tsx             # Nav + CustomCursor + <Outlet> + Footer
    parts/
      Header.tsx               # Already cleared to null
      Footer.tsx               # Already cleared to null
  styles/
    globals.css                # Already configured
  App.tsx / routes.tsx         # Update routes
```

---

## Asset Inventory

All images AI-generated. Fashion/music editorial mood, warm neutrals, high contrast.

### Hero / Video Placeholder
| File | Dimensions | Prompt |
|------|-----------|--------|
| `public/images/hero-loop.jpg` | 1920×1080 | A slow-motion fashion film still: a model in a bone-white structured coat stands in a vast empty industrial space, dramatic side lighting, warm charcoal shadows, film grain, editorial |

### Case Study 1 — "Veil" (fashion label identity)
| File | Dimensions | Prompt |
|------|-----------|--------|
| `public/images/cs1-hero.jpg` | 1600×900 | Minimalist fashion brand identity system laid flat on warm bone paper: logo, business cards, tissue paper, editorial photography, tobacco and charcoal palette |
| `public/images/cs1-still-1.jpg` | 1200×800 | Close-up of embossed letterpress business card on textured bone paper, warm side light, shallow depth of field |
| `public/images/cs1-still-2.jpg` | 1200×800 | Fashion lookbook spread open on a marble surface, editorial typography, warm neutrals |
| `public/images/cs1-process.jpg` | 1200×800 | Designer's desk with sketches, type specimens, and brand exploration sheets pinned to a wall, warm studio light |

### Case Study 2 — "Meridian" (music artist identity + motion)
| File | Dimensions | Prompt |
|------|-----------|--------|
| `public/images/cs2-hero.jpg` | 1600×900 | Music artist brand identity: vinyl record sleeve with bold editorial serif typography, dark charcoal background, warm tobacco accent lines, high contrast |
| `public/images/cs2-still-1.jpg` | 1200×800 | Album artwork mockup on a concrete surface, dramatic overhead lighting, deep shadows |
| `public/images/cs2-still-2.jpg` | 1200×800 | Motion graphics still frame: large typographic title card, cinematic letterbox crop, dark background |
| `public/images/cs2-process.jpg` | 1200×800 | Moodboard pinned to a dark wall: film stills, type samples, color swatches in charcoal and tobacco |

### Case Study 3 — "Arca" (fashion film title sequence)
| File | Dimensions | Prompt |
|------|-----------|--------|
| `public/images/cs3-hero.jpg` | 1600×900 | Film title sequence still: large editorial serif text over a blurred fashion film frame, warm grain, cinematic widescreen crop |
| `public/images/cs3-still-1.jpg` | 1200×800 | Behind-the-scenes on a fashion film set: camera crew, dramatic lighting rigs, model in motion, warm industrial space |
| `public/images/cs3-still-2.jpg` | 1200×800 | Film frame: model in motion, slow shutter, bone and charcoal tones, editorial |
| `public/images/cs3-process.jpg` | 1200×800 | Storyboard sheets and animatic frames spread on a light table, pencil sketches, warm light |

### Case Study 4 — "Lune" (music label brand system)
| File | Dimensions | Prompt |
|------|-----------|--------|
| `public/images/cs4-hero.jpg` | 1600×900 | Music label brand system: clean editorial layout with bold serif wordmark, warm bone background, tobacco accent, record sleeves and press materials |
| `public/images/cs4-still-1.jpg` | 1200×800 | Printed brand guidelines book open on a desk, editorial typography, warm natural light |
| `public/images/cs4-still-2.jpg` | 1200×800 | Social media mockup grid for a music label: consistent editorial aesthetic, warm neutrals |
| `public/images/cs4-process.jpg` | 1200×800 | Type exploration sheets: large serif letterforms printed and pinned, pencil annotations, studio light |

### Studio / About
| File | Dimensions | Prompt |
|------|-----------|--------|
| `public/images/studio-portrait.jpg` | 1200×1600 | Portrait of a creative director in a minimal studio space, warm side light, bone walls, editorial, film grain |

### Work Index Thumbnails (cropped from heroes — reuse hero images)
No additional files needed — use cs1-hero through cs4-hero at 800×500 display size.

---

## Data File — Case Studies

`src/data/case-studies.ts` exports an array of 4 objects:

```ts
export interface CaseStudy {
  slug: string;
  title: string;
  category: string;
  year: string;
  client: string;
  services: string[];
  heroImage: string;
  stills: string[];
  processImage: string;
  summary: string;       // 1–2 sentence teaser
  challenge: string;     // paragraph
  approach: string;      // paragraph
  outcome: string;       // paragraph
}
```

---

## Component Architecture

### CustomCursor
- Replaces native cursor (cursor: none on body)
- Two elements: small dot (8px) + larger ring (32px)
- Uses `useSpring` from `"motion/react"` for ring lag
- Scales up on hoverable elements

### SplitReveal
- Props: `text: string`, `delay?: number`, `className?: string`
- Splits text into individual `<span>` per character
- Uses `useInView` from `"motion/react"` to trigger
- Each char animates: `y: 40 → 0`, `opacity: 0 → 1`, staggered by 0.03s
- Easing: `--ease-reveal`

### FadeIn
- Wraps any children
- `useInView` from `"motion/react"`, trigger once
- `y: 24 → 0`, `opacity: 0 → 1`
- Duration: 800ms, ease: `--ease-cinematic`

### Nav
- Fixed top, full width
- Left: "FORMLESS" wordmark (DM Sans 300, tracking-widest, small caps)
- Right: Work · Studio · Contact (DM Sans 300, tracking-wider)
- Background: transparent on scroll — no blur (blur is an anti-pattern per design.md). On scroll past 60px, background transitions to `hsl(var(--background))` over `300ms`.
- No hamburger — on mobile (below `md` / 768px): wordmark stays left, nav links collapse to a single row below the wordmark, font-size reduced to `0.6rem`, full-width, centered, spaced evenly

### Footer
- Minimal: email link left, Instagram + Vimeo right, © center
- All DM Sans 300, small, muted

---

## Page Specs

### Home (`/`)
1. **Hero** — full viewport, video loop (poster = hero-loop.jpg), large "FORMLESS" centered, tagline below ("Brand. Motion. Identity." — DM Sans label style, `opacity: 0.55`), scroll indicator
2. **Work Preview** — 2 featured case studies side by side (2-column grid at `md`+; stacks to single column below `md`), large images, title + category
3. **Studio Teaser** — single bold statement line + "Studio →" link
4. **Footer**

### Work (`/work`)
1. **Page header** — "Work" in large display serif, thin rule below
2. **Case study grid** — 2-column at `md`+, stacks to single column below `md`; each card: full-bleed image, title (SplitReveal on hover/scroll), category, year
3. **Footer**

### Case Study (`/work/:slug`)
1. **Hero** — full-bleed image, title SplitReveal, category + year metadata
2. **Summary** — large pull-quote style intro paragraph
3. **Challenge / Approach / Outcome** — 3 editorial text sections with FadeIn
4. **Stills grid** — 2-column image grid at `md`+; stacks to single column below `md`
5. **Process** — full-width process image + caption
6. **Next project** — link to next case study
7. **Footer**

### Studio (`/studio`)
1. **Hero** — large statement: "We make brands feel alive" SplitReveal
2. **About copy** — 2 paragraphs of founding story copy:
   - P1: "Formless was founded on the belief that a brand's most powerful asset is its feeling — the quiet authority of a typeface, the weight of silence between frames, the precision of a considered palette."
   - P2: "We work with fashion labels, musicians, and cultural institutions who understand that restraint is a form of confidence. Our practice spans identity, motion, and art direction — always in service of the work."
3. **Services** — 3-column at `md`+: Brand Identity · Motion Design · Art Direction; stacks to single column below `md`, each item separated by a `Divider`
4. **Portrait** — full-width studio portrait
5. **Footer**

### Contact (`/contact`)
1. **Header** — "Let's work together" display type
2. **Form** — name, email, message (minimal styled inputs, no borders except bottom line)
3. **Direct email** — "Or reach us at hello@formless.studio"
4. **Footer**

---

## Animation System

### Custom Cursor
- `cursor: none` on `body`
- Dot: `position: fixed`, `width: 8px`, `height: 8px`, `border-radius: 50%`, `background: hsl(var(--foreground))`, follows `mousemove` directly
- Ring: `position: fixed`, `width: 32px`, `height: 32px`, `border: 1px solid hsl(var(--foreground) / 0.4)`, `border-radius: 50%`, follows with `useSpring({ stiffness: 150, damping: 20 })`
- On hover of links/buttons: dot scales to 0, ring scales to 48px and fills at 10% opacity

### Letter-by-Letter Reveal (SplitReveal)
- Split string into chars, wrap each in `<motion.span style={{display:'inline-block'}}`
- `initial: { y: '100%', opacity: 0 }` → `animate: { y: 0, opacity: 1 }`
- Stagger: 0.025s per char
- Trigger: `useInView` with `once: true`, `margin: "-10%"`
- Overflow hidden on parent to clip the reveal

### Page Transitions
- Wrap `<Outlet>` in `<AnimatePresence>`
- Each page: `initial: { opacity: 0 }` → `animate: { opacity: 1 }` → `exit: { opacity: 0 }`
- Duration: 400ms

### Scroll Reveals (FadeIn)
- Used on all body sections
- `useInView` with `once: true`, `margin: "-5%"`

---

## Build Order

Phases 0+1 run in parallel. Within Phase 2, all three builders run in parallel. Phase 3 runs last.

### Phase 0 — Media (parallel with Phase 1)
- Generate and place all images listed in Asset Inventory into `public/images/`

### Phase 1 — Foundation (parallel with Phase 0)
- Install no new deps (all already present)
- `src/data/case-studies.ts` — full data array with all 4 case study objects matching the `CaseStudy` interface
- `src/layouts/RootLayout.tsx` — Nav + CustomCursor + `<Outlet>` + Footer, `<AnimatePresence>` wrapping Outlet
- `src/components/layout/Nav.tsx` — per Nav spec above
- `src/components/layout/Footer.tsx` — per Footer spec above
- `src/components/cursor/CustomCursor.tsx` — per CustomCursor spec above
- `src/components/ui/SplitReveal.tsx` — per SplitReveal spec above
- `src/components/ui/FadeIn.tsx` — per FadeIn spec above
- `src/components/ui/Divider.tsx` — thin 1px rule
- Route stubs only for `Home`, `Work`, `CaseStudy`, `Studio`, `Contact` (each returns a single `<div>` with the page name)
- Update `src/routes.tsx` with all routes under `RootLayout`

### Phase 2 — Page Builders (all three run in parallel)

#### Builder A — Home + Work
- `src/pages/Home.tsx` — full page: Hero, WorkPreview, StudioTeaser, Footer
- `src/components/home/Hero.tsx`
- `src/components/home/WorkPreview.tsx` — reads first 2 items from `case-studies.ts`
- `src/components/home/StudioTeaser.tsx`
- `src/pages/Work.tsx` — full page: page header, case study grid, Footer
- `src/components/work/CaseStudyCard.tsx`

#### Builder B — Case Study + Studio
- `src/pages/CaseStudy.tsx` — dynamic page reading slug from URL params, all 7 sections
- `src/components/case-study/CaseStudyHero.tsx`
- `src/components/case-study/CaseStudyBody.tsx`
- `src/components/case-study/CaseStudyProcess.tsx`
- `src/pages/Studio.tsx` — full page: StudioHero, about copy, Services, portrait, Footer
- `src/components/studio/StudioHero.tsx`
- `src/components/studio/StudioValues.tsx`

#### Builder C — Contact
- `src/pages/Contact.tsx` — full page: header, form, direct email, Footer
- `src/components/contact/ContactForm.tsx`

### Phase 3 — Polish
- SEO: add `<Helmet>` tags (title + meta description) to all 5 pages using `@dr.pogodin/react-helmet`
- Page transitions: verify `<AnimatePresence>` + per-page `motion.div` wrappers
- Animation refinement: audit stagger timings, `prefers-reduced-motion` fallbacks on SplitReveal + FadeIn
- a11y: ensure all images have `alt` text, form inputs have associated `<label>` elements, focus styles visible

---

## Success Criteria

- `npm run type-check` (`tsc --noEmit`) exits with 0 errors
- `grep -r "framer-motion" src/` returns no matches (all animation imports use `"motion/react"`)
- `grep -r "react-helmet-async" src/` returns no matches (SEO uses `"@dr.pogodin/react-helmet"`)
- Route files exist: `src/pages/Home.tsx`, `src/pages/Work.tsx`, `src/pages/CaseStudy.tsx`, `src/pages/Studio.tsx`, `src/pages/Contact.tsx`
- `grep -r "blur" src/components/layout/Nav.tsx` returns no matches (blur is an anti-pattern)
- `grep "hsl(var(--" src/styles/globals.css` confirms design tokens are present (no raw hex literals in component files — verify with `grep -r "#[0-9a-fA-F]\{3,6\}" src/components/`)
- All 4 case studies render: `case-studies.ts` exports an array of length 4, each object satisfying the `CaseStudy` interface
- Contact form `onSubmit` handler calls `console.log` with the form data shape `{ name, email, message }` (or triggers a `mailto:` fallback)
- Custom cursor components exist at `src/components/cursor/CustomCursor.tsx`
- `SplitReveal` and `FadeIn` components exist at `src/components/ui/`
- All `<img>` tags in case study and studio components have non-empty `alt` attributes: `grep -r "<img" src/components/ | grep -v 'alt="[^"]'` returns no matches
- No `TODO` or `TBD` strings remain in `src/`: `grep -r "TODO\|TBD\|placeholder\|lorem" src/` returns no matches
