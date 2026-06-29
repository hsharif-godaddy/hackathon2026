## Output Format

Generate a single, cohesive prompt that:
- Is 400-1000 words (longer to include actual content)
- Is actionable and specific
- **Includes actual content from the source, quoted verbatim**
- References specific imported assets
- Includes design specifications with concrete values
- **Explicitly includes header AND footer requirements**

## Important Notes

- **ALWAYS quote actual content from the source page** - this is about optimization, not creation
- Be specific, not generic
- **Use the media tool** to place images — this registers them as swappable media slots
- Exception: on a **redesign**, reference the imported logo by its `/assets/images/` path directly (the media tool can't route to the source logo when fresh imagery is enabled)
- When "Let Airo Decide" is chosen, YOU make the design decisions - don't pass that to the develop agent
- Keep the prompt focused and actionable
- **ALWAYS include explicit instructions for BOTH header AND footer** - the footer is essential and should not be omitted
- Set the project name using the site's name or brand
- Tell the develop agent to use the imported images for key branding elements
