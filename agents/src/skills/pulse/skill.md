---
name: pulse
description: Apply a Pulse AI fix — make the targeted code change identified by the Pulse analysis
whenToUse: >-
  A pulse_insight context attachment is present. The user has tapped "Fix it"
  from the Pulse insight card. Do not load this skill for general site improvements
  or when the user describes a problem in their own words — only load it when a
  pulse_insight attachment is explicitly present.
intents:
  - fix it
  - apply pulse fix
  - pulse insight
  - pulse_insight context attachment
---

# Pulse Skill

Apply the fix identified by Pulse analysis. The insight card already told the owner what the problem is. Your job is to make the change — no explanation, no questions, no preamble.

## How to read the context attachment

The `pulse_insight` context attachment contains:

```
problemType: 'cta_buried' | 'contact_hidden' | 'no_social_proof'
suggestedFix: plain English description of the change to make
filesRead: list of files that were analyzed
headline: the stat shown to the owner ("31 visited, 1 contacted")
```

Use `problemType` to understand exactly what kind of change is needed. Use `filesRead` as your starting point for which files to open. Use `suggestedFix` as your instruction.

## Fix strategies by problem type

### `cta_buried`
The primary CTA button is too far down the page. Open the homepage component (usually `src/pages/index.tsx` or `src/components/Hero.tsx`). Find the primary CTA button. Move it into the hero section so it appears above the fold. Do not change the button's text or style — only its position.

### `contact_hidden`
The contact form has too much friction. Open the contact component (usually `src/components/Contact.tsx`). Either reduce the form to 2 fields (name and message, remove everything else) or move the contact section to the top of the page. Pick whichever matches the `suggestedFix` text.

### `no_social_proof`
There are no testimonials or reviews. Open the homepage component. Add a testimonials section with 3 placeholder reviews after the hero section. Use realistic-sounding names and short review text relevant to the business type. Keep the visual style consistent with the rest of the page.

## Rules

- **Act immediately.** Do not ask "are you sure?" or "which option do you prefer?" — the owner already chose by tapping "Fix it".
- **One change only.** Make exactly the fix described. Do not refactor surrounding code, rename variables, or improve anything else you notice.
- **Read the files listed in `filesRead` first.** They were already identified as the relevant files during analysis.
- **After the fix**, tell the owner in one sentence what changed. Then ask: "Ready to publish?"
- **If the fix fails** (file not found, unexpected structure), tell the owner: "I couldn't apply this fix automatically. Here's what I was trying to do: [suggestedFix]. You can describe the change to me and I'll make it manually."
