# SUMMARY Phase

After all generation is done:

## 1. MANDATORY: Save campaign and show artifact card via `marketing-campaigns__campaignPlanCreate`

**You MUST call `marketing-campaigns__campaignPlanCreate` here.** This creates the campaign artifact card with the "Launch Campaign" button. If you skip this, there is no way for the user to launch.

```javascript
marketing-campaigns__campaignPlanCreate({
  name: '[Campaign Name]',
  offer: '[offer/goal description]',
  startDate: '[YYYY-MM-DD]',
  endDate: '[YYYY-MM-DD]',
  campaignType: 'landing-page', // always 'landing-page'; never 'content-only'
  landingPagePath: '/[slug]',
  plannedContent: [
    { assetType: 'landing-page', title: '[title]', scheduledDate: '[date]', contentPreview: '[description]' },
    { assetType: 'blog', title: '[title]', scheduledDate: '[date]', contentPreview: '[what was created]' },
    { assetType: 'social', title: '[title]', scheduledDate: '[date]', contentPreview: '[post angle]' },
  ]
})
```

(Supported channels are landing page, blog, and Facebook social only — do not add `email` or `ad` assets.)

**Status is system-owned — you do NOT set it.** There is no `status` field to pass: at SUMMARY the system persists every asset as `'draft'` (nothing is scheduled or published pre-launch), and the launch flow (RUBICON-448) is what advances the state. The card's badge reflects this system value, so it never claims work the user hasn't done yet.

For each **social** asset in `plannedContent`, also pass `rawContent` — the exact `message`, `hashtags`, `callToAction`, and `platform` you generated with `socialPostCreate`. This stores the editable draft so the user can revise or delete the post before launch. Non-social assets do not take `rawContent`.

## 2. Present the summary — honestly, with any pending customer actions FIRST

**NEVER say the campaign OR any of its assets are "live", "launched", "running", "active", or "published."** Nothing is public until the user **publishes the site** — that is what makes the landing page and blog reachable; social posts also still need the user to connect an account and publish them. (**Launch Campaign** only marks the campaign active on the card; it does NOT publish anything.) **Open your summary with the "built and ready to launch" framing** (e.g. *"Your [Campaign Name] campaign is built and ready to launch."*) — do NOT open with "X is live" or "all assets are live." The landing page and blog exist in the build/preview but are NOT publicly live until the site is published; built ≠ live, so never tag a built asset as already live.

If VERIFY found pending customer actions (e.g. social accounts not connected), call them out BEFORE the launch framing. Do NOT imply everything will go live automatically when a connection is still needed.

```markdown
## Your [Campaign Name] campaign is built!

**Before you launch — pending action(s):** [include this block ONLY if something is pending]
- Connect your Facebook/Instagram accounts (Settings → social) so your social posts can publish. They're written and saved — they just need the connection to go out.

Here's everything that was created:
- **Landing page** at /[slug] — [description] (built — goes live when you publish your site)
- **Blog posts** — [titles and dates] (built — go live when you publish your site)
- **Social posts** — [angles and dates] — ready to publish [once connected]

> **Publish your site to make the landing page live.** Generating the landing page adds it to your site, but visitors can't reach it until you **publish your site**. The page is only live during your campaign window ([start] to [end]).

Hit **Launch Campaign** on the card above when you're ready.
```

**MANDATORY when a landing page was created — never skip, even in a short summary:** you MUST (1) include the **"Publish your site"** reminder blockquote above, and (2) make **"Publish my site"** the FIRST suggested response in Step 3 below. The landing page is added to the site but is NOT reachable by visitors until the customer publishes — omitting the publish prompt is the single most common failure of this skill, so treat it as required, not optional.

If there are NO pending actions (everything the customer needs is already connected), drop the "Before you launch" block and simply confirm the campaign is ready to launch.

## 3. Show next steps

```javascript
suggestedResponse({
  question: "Your campaign content has been generated. What would you like to do?",
  suggestions: [
    // Include this FIRST whenever a landing page was created — the page is not
    // reachable by visitors until the site is published.
    { text: "Publish my site" },
    { text: "Launch the campaign" },
    { text: "Review the content in detail" },
    { text: "Make changes to the campaign" },
    { text: "That looks great, I'll publish later" }
  ]
})
```

The user can click "Launch Campaign" on the campaign card to mark the campaign active — this is a status marker on the card; it does NOT publish the site or push any asset live. Publishing the site (above) is what makes the landing page and blog reachable to visitors.

**Publishing the site:** If the user chooses "Publish my site" (or otherwise asks to publish), publish the site so the landing page goes live — this runs the standard publish flow (the `publishing__publish` tool), which prompts the user for confirmation in the browser. Only publish on the user's explicit request; never auto-publish after generating the campaign.
