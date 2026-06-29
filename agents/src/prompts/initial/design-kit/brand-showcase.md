# Brand Showcase

The brand showcase is a self-contained brand-specimen page at `public/brand-showcase.html`. You
do NOT write it yourself — in the website phase you dispatch a `builder` sub-agent to write it
(see "Create website"). That builder has no `brand` tool and cannot see this prompt, so this is
the spec you transcribe into its task: the required sections, the brand content (read it back
with `brand({ mode: "get" })` and inline the real values), and the rules below. It is opened
standalone — it is NOT a website page and is never published.

## Brand content to pass in (read it first)
Call `brand({ mode: "get" })` once — it returns the whole brand in a single read: identity
(brandName, tagline, voice, audience, personality, mission), summary, imagery keyword, colours,
typography, and the chosen kit. Inline the relevant values into the builder's task — name,
tagline, voice words, 2–3 sentence summary, the imagery keyword — plus the asset slot paths
below. The mood images live in slots `brand/mood-1` … `brand/mood-4`; the logo (horizontal) in
`logo/horizontal`.

## Required sections
- **Brand idea** — brand name + tagline + the summary line. Display font.
- **Logo** — render `/airo-assets/images/logo/horizontal` large (hero scale).
- **Colour** — every palette swatch with hex labels, grouped.
- **Typography** — display + body samples (H1/H2/H3/body/caption) in real brand copy.
- **Brand mood** — the four mood images in a grid, captioned with the imagery keyword. Render
  each by slot path: `<img src="/airo-assets/images/brand/mood-1">` … `brand/mood-4`.
- **Voice & tone** — the voice descriptors + 2–3 example lines in the brand's voice.
- **At least one kit component sample** (a button row or card pair).

## Hard rules (put these in the builder's task)
- **Write to exactly `public/brand-showcase.html`.** Vite serves the `public/` directory at the
  site root, so the file is reachable at `/brand-showcase.html`. Do NOT write it to the project
  root, `src/`, or anywhere else.
- It is a **static** file — the builder must NOT run `tsc`, restart the server, or touch `src/`.
- **Plain HTML + CSS only.** Do not import any React/template code (no Header/Footer/RootLayout).
- **Style only with CSS variables** — `var(--background)`, `var(--foreground)`, `var(--primary)`,
  `var(--font-heading)`, `var(--font-sans)`, etc. Never hardcode hex or font-family stacks
  (printing hex strings as swatch labels is fine).
- `<link rel="stylesheet" href="/brand-tokens.css">` in `<head>` — this provides all the
  variables (synced from the user's palette + fonts).
- Design it as a brand-guide specimen, not a website page: numbered sections, hairline dividers,
  mono captions; no nav, CTA, or footer.
