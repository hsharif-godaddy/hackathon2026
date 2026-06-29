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
  /** True when the upload is a video file. Takes precedence over isImage for fileKind derivation and slot-reference wording (<video> vs <img>). */
  isVideo?: boolean
  /** True when auto-register routed to a fresh `uploads/<role>-<slug>` instead of the canonical role slot (AIROBUILD-2789 guard fired). Adjusts hero/background guidance so the agent doesn't silently swap the rendered hero. */
  deflectedFromCanonical?: boolean
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

/**
 * Hard guardrail for "place this image" turns. The user handed over their own
 * file, so a stock/Getty search or an AI-generated substitute for that same
 * spot is wrong work — it burns credits and lands an image the user did not
 * ask for. Steering to `import_upload` alone was not enough: the agent could
 * still fall back to its general media instinct (other prompts even encourage
 * stock search) and search anyway. Appended to every branch where the upload
 * IS meant to go on the site (display / hero / background / unclear-then-placed),
 * but NOT to reference_only (which intentionally generates/derives assets) or
 * logo (which already declares the upload the source of truth).
 */
const USE_UPLOADED_NOT_STOCK: string =
  '- This is the user\'s OWN uploaded file and is the source of truth for THIS placement. Place that file (via `import_upload`, or the slot URL above). Do NOT run a Getty/stock `search` and do NOT generate a substitute image for this spot — the user already gave you the exact image they want here. Only search for stock when the user explicitly asks for a DIFFERENT, additional image you were not given.'

const USE_UPLOADED_VIDEO_NOT_STOCK: string =
  '- This is the user\'s OWN uploaded video and is the source of truth for THIS placement. Place that file (via `import_upload`, or the slot URL above). Do NOT run a Getty/stock `search` and do NOT generate a substitute video for this spot — the user already gave you the exact video they want here. Only search for stock when the user explicitly asks for a DIFFERENT, additional video you were not given.'

/**
 * Placement-hygiene rules appended to every "place this on the site" branch
 * (display_on_site + unclear). These target the failure modes that turn a
 * one-turn placement into a 10-50 turn credit-burning loop, observed across
 * real sessions:
 *
 *  - "wrong image again" → the agent mints a NEW slot (`-v2`, `-v3`, `-final`)
 *    instead of updating the slot already wired into the page, so the page
 *    never changes and the user keeps seeing the old image.
 *  - On a correction turn the agent re-imports a PRIOR turn's stored filename
 *    (a stale upload) rather than the file the user just attached.
 *  - Several look-alike images uploaded together get assigned by upload order
 *    (a guess) and land swapped.
 */
const PLACEMENT_HYGIENE: readonly string[] = [
  '- CORRECTING A WRONG/SWAPPED IMAGE: if the user says the image you placed is wrong, swapped, or "still wrong", the slot is ALREADY wired into the page code. Re-run `import_upload` with the SAME slot path already in the code — NEVER create a new slot variant (`-v2`, `-v3`, `-final`, `-fixed`). A new slot name is not referenced by the page, so nothing visibly changes and the user keeps seeing the old image. To swap two images that landed in the wrong slots, re-import each correct file into its existing slot path.',
  '- ALWAYS import the file the user attached THIS turn, not a filename from an earlier turn. Do not reuse a previously-uploaded stored filename on a correction turn — that re-places the old (wrong) image.',
  '- MULTIPLE IMAGES AT ONCE: when several images are uploaded together for distinct positions (e.g. front / back / label views, or near-identical product photos), do NOT assign them by upload order — that is a guess and usually lands them swapped. State which image you believe goes where in plain language and confirm before importing if there is any ambiguity.',
]

export function buildUploadHandlingGuidance(input: UploadHandlingInput): string {
  const fileKind = input.isVideo ? 'video' : input.isImage === false ? 'document' : 'image'
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
      '- User intent: **logo on the site** — place the UPLOADED file itself. Do NOT recreate, trace, or redraw it as inline SVG or canvas; the upload is the source of truth.',
      `- Create it with empty content so the system fills it from your upload: \`str_replace_based_edit_tool({ command: "create", path: "public/assets/${fileName}", file_text: "" })\`, then reference it: \`<img src="/assets/${fileName}" alt="logo" />\`.`,
      '- To show the logo in multiple places (e.g. header AND footer), reference the SAME `/assets/…` path in each — do not re-import or create a second copy.',
      '- Keep the uploaded filename; if you must rename, the system still resolves an empty image file from your most recent upload, but the original name is most reliable.',
      '- Use `/assets/…` (not a media slot) and never `/files/uploads/` URLs in source code.',
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
    // Sanitize the slot URL before interpolating into an agent-facing code span
    // (it derives from a partly filename-based semantic path).
    const slotUrl = sanitizeUploadFileNameForDisplay(input.slotUrl)
    if (input.deflectedFromCanonical) {
      // Deflected by AIROBUILD-2789 guard — require describe-before-replace, don't claim it's THE hero.
      lines.push(
        `- User intent: **display on site** — the upload was registered to a NEW slot \`${slotUrl}\`. The canonical ${role} still has the user's previously accepted image.`,
        `- Do NOT swap the rendered ${role} silently. FIRST describe the current ${role} in plain language ("Your current ${role} is the coffee photo") and ask whether to replace it with this new upload. Only after explicit "yes, replace it" do you edit the ${role} element's \`<img src>\` / CSS background to point at \`${slotUrl}\`.`,
        `- If the user prefers to keep both, use \`${slotUrl}\` for a new section/element rather than the canonical ${role}.`,
        '- Do NOT copy to public/assets or use /files/uploads/ for this image.',
        USE_UPLOADED_NOT_STOCK,
      )
      return lines.join('\n')
    }
    lines.push(
      `- User intent: **display on site** — this is the ${role} image; use slot URL \`${slotUrl}\` in code`,
      '- Do NOT copy to public/assets or use /files/uploads/ for this image.',
      USE_UPLOADED_NOT_STOCK,
    )
    return lines.join('\n')
  }

  if (input.placementIntent === 'display_on_site') {
    const filename = input.storedUploadFilename
      ? sanitizeUploadFileNameForDisplay(input.storedUploadFilename)
      : '<stored-upload-filename-from-listUploadedFiles>'
    const slotRefLine = input.isVideo
      ? '- Use the returned `slotUrl` in `<video src="…">` (NOT `<img>`).'
      : '- Use the returned `slotUrl` in `<img src="…">` or CSS background-image.'
    lines.push(
      '- User intent: **display on site** — register a media slot for THIS placement:',
      `\`media({ action: "import_upload", slot: "<semantic-name>", filename: "${filename}" })\``,
      '- Each position on the site is its own slot. ADDING a new element (e.g. another card) → use a NEW slot name. REPLACING an existing element → FIRST describe the current contents in plain language ("Your current hero is the coffee photo — want me to replace it with this one?") and wait for an explicit "yes, replace it" before passing that element\'s slot path to `import_upload`. Do NOT replace silently. If the user prefers to keep both, register to a NEW slot name instead. The same uploaded file can back multiple slots and they update independently.',
      slotRefLine,
      input.isVideo ? USE_UPLOADED_VIDEO_NOT_STOCK : USE_UPLOADED_NOT_STOCK,
      ...PLACEMENT_HYGIENE,
    )
    return lines.join('\n')
  }

  const unclearFilename = input.storedUploadFilename
    ? sanitizeUploadFileNameForDisplay(input.storedUploadFilename)
    : '<stored-upload-filename-from-listUploadedFiles>'
  const unclearSlotRefLine = input.isVideo
    ? `- Then use the returned \`slotUrl\` in \`<video src="…">\` (NOT \`<img>\`). Do NOT copy to public/assets or use /files/uploads/ for this video.`
    : `- Then use the returned \`slotUrl\` in \`<img src="…">\` or CSS background-image. Do NOT copy to public/assets or use /files/uploads/ for this image.`
  lines.push(
    '- User intent: **unclear** — the user uploaded this but has not said where it should go.',
    '- Ask where they want it before placing it. Do NOT place it on the site until the user tells you where.',
    '- IMPORTANT — vague positive sentiment is NOT a placement instruction: "I like this", "nice photo", "looks great", "love it", "perfect", "cool". A bare "yes" is also not placement unless it directly answers a yes/no placement question you asked in your previous message (e.g. you asked "should I use this as the hero?" → "yes" is confirmation).',
    '- Once the user names an explicit location, register the upload:',
    '  - ADDING a new element → use a NEW semantic slot name.',
    '  - REPLACING an existing element → FIRST describe the current contents in plain language ("Your current hero is the coffee photo — want me to replace it with this one?") and wait for an explicit "yes, replace it" before calling `import_upload` against that slot path. Do NOT replace silently. If the user prefers to keep both, register to a NEW slot name like `uploads/hero-<descriptor>` instead.',
    `\`media({ action: "import_upload", slot: "<semantic-name>", filename: "${unclearFilename}" })\``,
    `- REPLACING an existing ${input.isVideo ? 'video' : 'image'} — pass that element's EXACT existing slot path so the ${input.isVideo ? 'video' : 'image'} updates in place; do NOT invent a new slot. ADDING a brand-new element — use a new semantic slot name.`,
    unclearSlotRefLine,
    input.isVideo ? USE_UPLOADED_VIDEO_NOT_STOCK : USE_UPLOADED_NOT_STOCK,
    ...PLACEMENT_HYGIENE,
  )
  return lines.join('\n')
}
