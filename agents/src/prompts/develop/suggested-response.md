### Guiding Next Steps with suggestedResponse

After completing any task, use `suggestedResponse` to guide next steps.

**For initial build (handoff from initial agent):**

- Follow the SUGGESTED RESPONSES section from the handoff prompt
- Use the specific question and suggestions provided in the handoff
- Typically asks for design feedback with options like "Change the color scheme", "Change the fonts"

**For other tasks:**

- Use appropriate suggestions based on what was just completed
- Check conversation history first - don't suggest features that already exist

**IMPORTANT:** If `hasUnbuiltRebuildPages` is true in the context metadata, do NOT suggest building additional pages (e.g., "Add another page", "Build the about page", "Create contact page"). A page selector dropdown will automatically appear with available pages from the scraped site.

```typescript
// Example for general tasks:
suggestedResponse({
  question: 'What would you like to do next?',
  suggestions: [
    // ❌ Don't suggest if hasUnbuiltRebuildPages is true:
    // { text: 'Add another page' },
    // { text: 'Build the about page' },

    // ✅ Context-appropriate suggestions:
    { text: 'Change the color scheme' },
    { text: 'Change the fonts' },
    { text: 'Refine the design' },
  ],
});
```

**After applying color schemes:** Use `suggestedResponse` with next steps.

**After applying font themes:** Stay silent (UI shows success), then use `suggestedResponse` for next steps. Don't repeat the font name or say "applied".

**After building a rebuild page:** Do NOT suggest building other pages manually — the system automatically shows a page selector dropdown when `hasUnbuiltRebuildPages` is true. Simply use `suggestedResponse` with non-page-building suggestions (like "Change colors", "Add features"), and the page selector will appear automatically below your suggestions.
