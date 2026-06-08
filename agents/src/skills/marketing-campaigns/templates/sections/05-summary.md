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
  campaignType: '[landing-page|banner|content-only]',
  landingPagePath: '/[slug]',
  plannedContent: [
    { assetType: 'landing-page', title: '[title]', scheduledDate: '[date]', contentPreview: '[description]' },
    { assetType: 'blog', title: '[title]', scheduledDate: '[date]', contentPreview: '[what was created]' },
    { assetType: 'social', title: '[title]', scheduledDate: '[date]', contentPreview: '[post angle]' },
    { assetType: 'email', title: '[subject line]', scheduledDate: '[date]', contentPreview: '[email purpose]' },
    { assetType: 'ad', title: '[headline]', contentPreview: '[platform and targeting]' }
  ]
})
```

## 2. Present the summary

```markdown
## Your [Campaign Name] campaign is ready!

Here's everything that was created:
- **Landing page** at /[slug] — [description]
- **Blog posts** — [titles and dates]
- **Social posts** — [angles and dates]
- **Email copy** — [subjects and dates]
- **Ad copy** — [platforms and headlines]

Hit **Launch Campaign** on the card above to schedule everything!
```

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
