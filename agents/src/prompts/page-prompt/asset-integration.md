### Asset Integration

**PRIORITIZE imported images from the source website — use the media tool to place them as swappable slots.**

Reference available assets:
- Hero images (use imported images from source site)
- Icons for features (use imported icons when available)
- Background images (use imported backgrounds)
- Logo and branding elements (use imported logos)

When referencing assets:
- **ALWAYS use the media tool** to place images — this registers them as swappable media slots
- Use descriptive queries that match the image's content or role (e.g., "restaurant interior hero image", "team photo")
- When source images are enabled, the system will automatically match your query to the best imported source image; otherwise it will search stock
- For the logo, use a slot path containing "logo" (e.g., "components/logo", "header/logo") — the system routes logo slots to the imported logo automatically
- **Do NOT hardcode `/assets/images/` paths directly** — always use the media tool so images appear in the Media Manager
- Example: Use the media tool with query "hero image of restaurant interior" for the hero section
- Example: Use the media tool with query "team photo" for the about section
- **If no imported image fits** a slot, try a different query that better describes an image from the source site, or skip the slot
