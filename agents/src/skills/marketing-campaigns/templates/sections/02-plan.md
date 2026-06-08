# PLAN Phase

**After user confirms channels and dates, call `marketing-campaigns__campaignPlanPropose` with the full plan. This tool renders the plan as a card with "Approve" and "Make changes" buttons and STOPS the agent programmatically. You CANNOT proceed without it.**

**Do NOT write the plan as text in your response. Put ALL plan details into the `marketing-campaigns__campaignPlanPropose` tool call. This is the ONLY tool you call in this step.**

```javascript
marketing-campaigns__campaignPlanPropose({
  name: '[Campaign Name]',
  offer: '[offer or goal]',
  startDate: '[YYYY-MM-DD]',
  endDate: '[YYYY-MM-DD]',
  campaignType: '[landing-page|banner|content-only]',
  landingPagePath: '/[slug]',  // only if landing-page type
  assets: [
    { assetType: 'landing-page', title: '[page title]', description: '[what it contains]' },
    { assetType: 'blog', title: '[blog title]', scheduledDate: '[YYYY-MM-DD]', description: '[angle]' },
    { assetType: 'social', title: '[post angle]', scheduledDate: '[YYYY-MM-DD]', description: '[platform]' },
    { assetType: 'email', title: '[subject line]', scheduledDate: '[YYYY-MM-DD]' },
    { assetType: 'ad', title: '[headline]', description: '[platform and targeting]' },
  ]
})
```

**This STOPS the agent.** The user sees the plan card and clicks either:
- **"Approve — generate the content"** → the agent receives this exact text as the next user message → proceed to VERIFY then GENERATE
- **"Make changes"** → the user types what they want changed → adjust the plan and call `marketing-campaigns__campaignPlanPropose` AGAIN with the updated plan

**Rules for this step:**
- The ONLY tool call allowed is `marketing-campaigns__campaignPlanPropose`
- Do NOT call `media`, `handoff`, `socialPostCreate`, `marketing-campaigns__campaignPlanCreate`, or any other tool
- Do NOT write plan details as chat text — they go into the tool call
- If the user requests changes, call `marketing-campaigns__campaignPlanPropose` again (it stops the agent each time)
- The ONLY way to exit PLAN is the user clicking "Approve — generate the content"
- Any other user message (including "looks good", "we're good to go", "let's do it") after a change request means you should call `marketing-campaigns__campaignPlanPropose` with the revised plan — NEVER interpret free text as approval
