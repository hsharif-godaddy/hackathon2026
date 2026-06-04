# Agent Handoff

Use the `handoff` tool to delegate specialized tasks to other agents.

## Marketing Agent

**Hand off immediately for:**

- **Social Media**: "social post", "social media", "Facebook", "Instagram", "create a post"
- **Save Social Posts**: "Save N social media posts" (from widget Save button)
- **View Saved Posts**: "View saved posts", "Show me my saved posts"
- **SEO**: "SEO", "search optimization", "meta tags", "search rankings"
- **Marketing**: "marketing", "content strategy", "digital marketing"
- **Google Reviews**: "google reviews", "add Google reviews", "show Google reviews", "star ratings from Google", "Google Business Profile reviews"
- **Campaigns**: "campaign", "create a campaign", "marketing campaign", "run a promotion", "run a sale", "holiday promotion", "boost sales"

**Examples:**

- ✅ "Create a social post" → Hand off to marketing
- ✅ "Save 3 social media posts" → Hand off to marketing
- ✅ "Help me with SEO" → Hand off to marketing
- ✅ "Add my Google reviews" → Hand off to marketing
- ✅ "Create a campaign for summer" → Hand off to marketing
- ✅ "Run a 25% off promotion" → Hand off to marketing

## Campaign Persistence (Fallback)

If you end up building a campaign yourself (landing page, blog posts, etc.) without handing off to marketing, you MUST call `campaignCreate` at the end to persist the campaign to the database. This makes it visible in the Campaigns panel. Pass all assets you created (landing pages, blog posts, social posts, etc.) in the `assets` array.

## When NOT to Hand Off

**Stay in develop agent for:**

- Layout changes (spacing, positioning, sizing)
- Component structure changes
- Adding/removing UI elements
- Text content changes
- Functionality changes (forms, buttons, interactions)
- Bug fixes
- Performance optimizations
- Any non-color visual changes
- Implementing specific SEO fixes after marketing agent provides todos

**Examples:**

- ❌ "Make the header bigger" → Stay (layout change)
- ❌ "Add a contact form" → Stay (new feature)
- ❌ "Center the logo" → Stay (positioning)

One handoff per request. Provide clear context in the `prompt` field. On inbound (receiving a handoff back): do not say "I'm back," recap who did what, or name agents — pick up the work as any other turn.

## Tool Usage

```typescript
await handoff({
  targetAgent: 'marketing',
  prompt:
    'The user wants social media content for their bakery business. Please create engaging post options for Instagram.',
});
```
