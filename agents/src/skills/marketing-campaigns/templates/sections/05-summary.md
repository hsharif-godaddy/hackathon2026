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
    { assetType: 'landing-page', title: '[title]', scheduledDate: '[date]', status: 'scheduled', contentPreview: '[description]' },
    { assetType: 'blog', title: '[title]', scheduledDate: '[date]', status: 'scheduled', contentPreview: '[what was created]' },
    { assetType: 'social', title: '[title]', scheduledDate: '[date]', status: 'draft', contentPreview: '[post angle]' },
    { assetType: 'email', title: '[subject line]', scheduledDate: '[date]', status: 'draft', contentPreview: '[email purpose]' },
    { assetType: 'ad', title: '[headline]', status: 'draft', contentPreview: '[platform and targeting]' }
  ]
})
```

**Set `status` honestly — nothing is published yet.** At this point the campaign is built but NOT launched. Use `'scheduled'` for built site assets (landing page, blog) that will go out when the campaign launches, and `'draft'` for social/email/ad that still need the user to publish or copy them out. **NEVER use `'published'` or `'sent'`** — those statuses claim work the user hasn't done yet (the site still needs Publish, social needs a connection, the campaign needs Launch). The badge on the card shows this status verbatim, so an inaccurate value is a false claim to the customer.

## 2. Present the summary — honestly, with any pending customer actions FIRST

**NEVER say the campaign OR any of its assets are "live", "launched", "running", "active", or "published."** Nothing is public until the user BOTH publishes the site AND clicks **Launch Campaign**. **Open your summary with the "built and ready to launch" framing** (e.g. *"Your [Campaign Name] campaign is built and ready to launch."*) — do NOT open with "X is live" or "all assets are live." The landing page and blog exist in the build/preview but are NOT publicly live until the site is published; built ≠ live, so never tag a built asset as already live.

If VERIFY found pending customer actions (e.g. social accounts not connected), call them out BEFORE the launch framing. Do NOT imply everything will go live automatically when a connection is still needed.

```markdown
## Your [Campaign Name] campaign is built!

**Before you launch — pending action(s):** [include this block ONLY if something is pending]
- Connect your Facebook/Instagram accounts (Settings → social) so your social posts can publish. They're written and saved — they just need the connection to go out.

Here's everything that was created:
- **Landing page** at /[slug] — [description] (built — goes live when you launch)
- **Blog posts** — [titles and dates] (built — publishes when you launch)
- **Social posts** — [angles and dates] — ready to publish [once connected]
- **Email copy** — [subjects and dates] — copy into your email tool
- **Ad copy** — [platforms and headlines] — copy into your ad manager

Hit **Launch Campaign** on the card above when you're ready.
```

If there are NO pending actions (everything the customer needs is already connected), drop the "Before you launch" block and simply confirm the campaign is ready to launch.

## 3. Show next steps

```javascript
suggestedResponse({
  question: "Your campaign content has been generated. What would you like to do?",
  suggestions: [
    { text: "Launch the campaign" },
    { text: "Review the content in detail" },
    { text: "Make changes to the campaign" },
    { text: "That looks great, I'll launch later" }
  ]
})
```

The user can click "Launch Campaign" on the campaign card to move the campaign to active status and begin the scheduled publishing.
