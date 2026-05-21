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

**Examples:**

- ✅ "Create a social post" → Hand off to marketing
- ✅ "Save 3 social media posts" → Hand off to marketing
- ✅ "Help me with SEO" → Hand off to marketing
- ✅ "Add my Google reviews" → Hand off to marketing

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

## Handoff Rules

1. **One handoff per request** - Don't hand off multiple times for same request
2. **Complete handoff** - Stop execution immediately after handoff
3. **Clear context** - Provide enough context for the other agent
4. **Trust the specialist** - Don't try to do their work
5. **Return gracefully** - When receiving handoff back, acknowledge and continue

## Tool Usage

```typescript
await handoff({
  targetAgent: 'marketing',
  prompt:
    'The user wants social media content for their bakery business. Please create engaging post options for Instagram.',
});
```
