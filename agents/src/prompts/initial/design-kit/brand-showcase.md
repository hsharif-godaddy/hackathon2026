# Brand Showcase (Step 4)

When the user triggers **Build my brand showcase**, write a self-contained brand specimen page to
`public/brand-showcase.html` using `str_replace_based_edit_tool` (create the file). Use a
workspace-relative path (`public/brand-showcase.html`), not a leading-slash absolute path.
**Only after the file is written**, call `setWizardStep({ step: 4 })` — the wizard reveals the
showcase as soon as you advance, so write first, then advance.
It is iframed standalone by the wizard — it is NOT a website page and is never published.

## Read content first
Call `brand({ mode: "get" })` once — it returns the whole brand in a single read: identity
(brandName, tagline, voice, audience, personality, mission), summary, imagery (keyword + the
mood images), colours, typography, and the chosen kit. Use the kit's `anchor.json` (via
`loadUiKit`) for component art direction. The brand mood images live in the media slots
`brand/mood-1` … `brand/mood-4` — reference them by slot path (below).

## Required sections
- **Brand idea** — brand name + tagline + the summary line. Display font.
- **Logo** — render `/airo-assets/images/logo/primary` large (hero scale).
- **Colour** — every palette swatch with hex labels, grouped.
- **Typography** — display + body samples (H1/H2/H3/body/caption) in real brand copy.
- **Brand mood** — the four mood images in a grid, captioned with the imagery keyword. Render
  each by slot path: `<img src="/airo-assets/images/brand/mood-1">` … `brand/mood-4` (the
  preview resolves the slot to the chosen photo). This is the section that shows, at a glance,
  how the brand looks and feels.
- **Voice & tone** — the voice descriptors + 2–3 example lines in the brand's voice.
- **At least one kit component sample** (a button row or card pair).

## Hard rules
- **Write to exactly `public/brand-showcase.html`.** Vite serves the `public/` directory at the
  site root, so this file is reachable at `/brand-showcase.html` (which is what the wizard loads).
  Do NOT write it to the project root, `src/`, or anywhere else — anywhere but `public/` and the
  wizard can never load it.
- **You write this showcase yourself.** Create and refine `public/brand-showcase.html` with
  `str_replace_based_edit_tool` — this is your own work at this step. If the user asks for
  showcase changes, edit `public/brand-showcase.html` directly and stay on this step.
- **Do not import any React/template code** (no Header/Footer/RootLayout). Plain HTML + CSS.
- **Style only with CSS variables** — `var(--background)`, `var(--foreground)`,
  `var(--primary)`, `var(--font-heading)`, `var(--font-sans)`, etc. Never hardcode hex or
  font-family stacks (printing hex strings as labels is fine).
- `<link rel="stylesheet" href="/brand-tokens.css">` in `<head>` — this provides all the
  variables (synced from the user's palette + fonts).
- Design it as a brand-guide specimen, not a website page: numbered sections, hairline
  dividers, mono captions; no nav, CTA, or footer.

## Required `<head>` boilerplate (copy verbatim)
Include this so live edits from the wizard reflect instantly without a rebuild:

```html
<link rel="stylesheet" href="/brand-tokens.css" />
<script>
  function hexToHsl(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex); if (!m) return '0 0% 0%';
    var r = parseInt(m[1],16)/255, g = parseInt(m[2],16)/255, b = parseInt(m[3],16)/255;
    var max = Math.max(r,g,b), min = Math.min(r,g,b), h=0, s=0, l=(max+min)/2;
    if (max!==min){var d=max-min; s=l>0.5?d/(2-max-min):d/(max+min);
      if(max===r)h=((g-b)/d+(g<b?6:0))/6; else if(max===g)h=((b-r)/d+2)/6; else h=((r-g)/d+4)/6;}
    return Math.round(h*360)+' '+Math.round(s*100)+'% '+Math.round(l*100)+'%';
  }
  var COLOR_MAP = {background:'--background',foreground:'--foreground',card:'--card',cardForeground:'--card-foreground',primary:'--primary',primaryForeground:'--primary-foreground',secondary:'--secondary',secondaryForeground:'--secondary-foreground',muted:'--muted',mutedForeground:'--muted-foreground',accent:'--accent',accentForeground:'--accent-foreground',destructive:'--destructive',destructiveForeground:'--destructive-foreground',border:'--border'};
  window.addEventListener('message', function (e) {
    var root = document.documentElement;
    if (e.data && e.data.type === 'PREVIEW_THEME' && e.data.palette) {
      Object.keys(COLOR_MAP).forEach(function (k) {
        var v = e.data.palette[k]; if (v) root.style.setProperty(COLOR_MAP[k], hexToHsl(v));
      });
      if (e.data.palette.primary) root.style.setProperty('--ring', hexToHsl(e.data.palette.primary));
    } else if (e.data && e.data.type === 'PREVIEW_FONT' && e.data.headerFont && e.data.bodyFont) {
      var link = document.getElementById('airo-preview-font-link');
      if (!link) { link = document.createElement('link'); link.id='airo-preview-font-link'; link.rel='stylesheet'; document.head.appendChild(link); }
      link.href = 'https://fonts.googleapis.com/css2?family=' +
        encodeURIComponent(e.data.headerFont.name).replace(/%20/g,'+') + '&family=' +
        encodeURIComponent(e.data.bodyFont.name).replace(/%20/g,'+') + '&display=swap';
      root.style.setProperty('--font-heading', '"' + e.data.headerFont.name + '", ui-sans-serif, system-ui, sans-serif');
      root.style.setProperty('--font-sans', '"' + e.data.bodyFont.name + '", ui-sans-serif, system-ui, sans-serif');
    }
  });
  // Signal the wizard that the brand showcase has finished loading so it can hide the loader.
  // Only the real showcase sends this; keep this line verbatim.
  if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'BRAND_SHOWCASE_READY' }, '*');
</script>
```
