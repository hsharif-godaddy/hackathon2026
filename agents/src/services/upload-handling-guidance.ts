export type ChatUploadAssetRole = 'logo' | 'hero_image' | 'background'

/**
 * Asset roles eligible for automatic media-slot registration. Logos are
 * intentionally excluded — they are placed under `/assets/`, not in slots.
 */
export type SlotEligibleAssetRole = Exclude<ChatUploadAssetRole, 'logo'>

export type UploadPlacementIntent = 'display_on_site' | 'reference_only' | 'unclear'

export interface UploadHandlingInput {
  fileName: string
  assetRole: ChatUploadAssetRole | null
  placementIntent: UploadPlacementIntent
  slotUrl?: string | null
  storedUploadFilename?: string | null
  isImage?: boolean
}

export function shouldAutoRegisterUpload(input: UploadHandlingInput): boolean {
  return (
    input.placementIntent === 'display_on_site' &&
    (input.assetRole === 'hero_image' || input.assetRole === 'background')
  )
}

/**
 * A user-supplied filename is interpolated into agent-facing markdown
 * (guidance, code-fence references). Strip newlines/control chars and
 * backticks so a crafted name can't break out of an inline code span or inject
 * structure into the instructions the agent reads. Display-only — never use
 * for disk lookups (those need the raw name).
 */
export function sanitizeUploadFileNameForDisplay(name: string): string {
  return name.replace(/[\n\r\t\0`]/g, '_').slice(0, 200)
}

export function buildUploadHandlingGuidance(input: UploadHandlingInput): string {
  const fileKind = input.isImage === false ? 'document' : 'image'
  const fileName = sanitizeUploadFileNameForDisplay(input.fileName)
  const lines = [
    '## Upload handling',
    `- File type: ${fileKind} (\`${fileName}\`)`,
    '- Follow these rules for this upload; ignore generic file-handling defaults unless they match here.',
    '- When you reply to the user, describe the result in plain language (e.g. "your photo is now the hero image" or "added as the first card in your Favourites section"). Do NOT expose slot names, `/airo-assets/…` URLs, or file paths in your reply — those are internal.',
  ]

  if (input.placementIntent === 'reference_only') {
    lines.push(
      '- User intent: **reference/inspiration only**',
      '- ⚠️ CRITICAL: do NOT place this file on the website. Do NOT use it as a hero image, background, logo, or any media slot. Do NOT embed it in any `<img>`, CSS background, or slot.',
      '- The user wants the site to FEEL LIKE or be INSPIRED BY this file — extract its colors, mood, typography style, and layout patterns and apply those to the site using existing or generated assets.',
      '- If a logo is needed, generate a NEW one using this file only as a visual reference (pass the upload signed URL as the reference) — do not embed the raw upload as the site logo.',
    )
    return lines.join('\n')
  }

  if (input.assetRole === 'logo') {
    lines.push(
      '- User intent: **logo on the site** — copy to `public/assets/` via create-with-empty-file, then use `/assets/…` in code (not a media slot)',
      '- Do NOT use `/files/uploads/` URLs in source code.',
    )
    return lines.join('\n')
  }

  // Only the auto-registered canonical roles (hero/background) own ONE fixed
  // slot that should be reused. A generic image can legitimately appear in
  // several positions (e.g. two different cards), so it must NOT pin a single
  // slot URL — that would couple the positions. Generic images fall through to
  // the per-position import_upload guidance below.
  if (input.slotUrl && (input.assetRole === 'hero_image' || input.assetRole === 'background')) {
    const role = input.assetRole === 'background' ? 'background' : 'hero'
    lines.push(
      `- User intent: **display on site** — this is the ${role} image; use slot URL \`${input.slotUrl}\` in code`,
      '- Do NOT copy to public/assets or use /files/uploads/ for this image.',
    )
    return lines.join('\n')
  }

  if (input.placementIntent === 'display_on_site') {
    const filename = input.storedUploadFilename ?? '<stored-upload-filename-from-listUploadedFiles>'
    lines.push(
      '- User intent: **display on site** — register a media slot for THIS placement:',
      `\`media({ action: "import_upload", slot: "<semantic-name>", filename: "${filename}" })\``,
      '- Each position on the site is its own slot. ADDING a new element (e.g. another card) → use a NEW slot name. REPLACING an existing element → pass that element\'s exact existing slot path. The same uploaded file can back multiple slots and they update independently — do NOT reuse another element\'s slot URL just because the image is the same.',
      '- Use the returned `slotUrl` in `<img src="…">` or CSS background-image.',
    )
    return lines.join('\n')
  }

  const unclearFilename = input.storedUploadFilename ?? '<stored-upload-filename-from-listUploadedFiles>'
  lines.push(
    '- User intent: **unclear** — the user uploaded this but has not said where it should go.',
    '- Ask where they want it before placing it. Do NOT place it on the site until the user tells you where.',
    '- The moment the user confirms a location — in THIS turn or a later reply such as "yes" / "the hero" / "on the homepage" — register it immediately, do NOT re-ask:',
    `\`media({ action: "import_upload", slot: "<semantic-name>", filename: "${unclearFilename}" })\``,
    '- REPLACING an existing image (e.g. "use this for the hero", "swap the about photo") → pass that element\'s EXACT existing slot path so the image updates in place; do NOT invent a new slot. ADDING a brand-new element → use a new semantic slot name.',
    '- Then use the returned `slotUrl` in `<img src="…">` or CSS background-image. Do NOT copy to public/assets or use /files/uploads/ for this image.',
  )
  return lines.join('\n')
}
