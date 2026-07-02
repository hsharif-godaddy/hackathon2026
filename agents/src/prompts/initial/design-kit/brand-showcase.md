# Brand Showcase

The brand showcase is a self-contained brand-specimen page at `public/brand-showcase.html` (a brand
guide, not a website page — opened standalone, never published). You do NOT write it yourself: in
the website phase you dispatch the dedicated **`brand-showcase`** sub-agent to write it (see
"Create website").

That agent owns the page's structure and rules — static HTML, styling from `/brand-tokens.css`
variables, the required sections, and referencing the already-generated logo/mood slots by URL. It
is file-only (no media/skill tools) so it can't re-generate assets, and it can't see this prompt or
call the `brand` tool. **Your only job is to hand it the brand content:** call `brand({ mode: "get" })`
once (identity, tagline, voice, summary, imagery keyword) and inline those real values into its
task. Don't transcribe the section list or rules — the agent already has them.
