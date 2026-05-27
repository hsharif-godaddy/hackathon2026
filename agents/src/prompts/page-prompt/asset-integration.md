### Asset Integration

**PRIORITIZE imported images from the source website, but stock images are still available when needed.**

Reference available assets:
- Hero images (use imported images from source site)
- Icons for features (use imported icons when available)
- Background images (use imported backgrounds)
- Logo and branding elements (use imported logos)

When referencing assets:
- Use the actual file paths provided in the asset manifest
- Specify which imported image should be used for each section
- **If the new design needs additional images** (e.g., new sections, decorative elements, or if imported images don't fit the new design), instruct the develop agent to search for appropriate stock images
- Example: "Use /assets/images/abc123.jpg for the hero section"
- Example: "Search for a modern office interior image for the About section background"
- Imported images from the source site use paths like /assets/images/ or /assets/other/
