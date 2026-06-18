# AIROBUILD-2364 — Findings

**Ticket:** [AIROBUILD-2364](https://godaddy-corp.atlassian.net/browse/AIROBUILD-2364) — *chat images upload are not getting media slot assigned*

**Date:** 2026-06-09

---

## Issue reported

When images are uploaded through chat and not assigned to a media slot:

- Editor not working
- Agent misses putting the image in the right place
- User loses images

---

## Issue observed

Images uploaded manually through **chat** are not assigned to an **image slot**. They land in the chat upload store (`/files/uploads/…`) but do not appear in the media slot system (`airo-media.json` / Media Manager) unless something else assigns them.

Slot assignment today is a separate, manual step (Media Manager) or depends on the agent following non-slot code paths.

---

## How chat uploads vs slots work

| Path | Assigns media slot? | Where image ends up in code |
|------|---------------------|-----------------------------|
| Chat upload only | **No** | Nowhere until agent or user acts |
| Media Manager → apply chat file to slot | **Yes** (existing slot required) | `/airo-assets/images/{slot}` |
| Media Manager → upload to slot | **Yes** | `/airo-assets/images/{slot}` |
| Edit mode → import non-slot image | **Yes** (creates slot) | `/airo-assets/images/{slot}` via `POST …/slots/import` |
| Agent `media` tool (Getty search) | **Yes** | Slot URL in code |
| Agent `media-image` / `media-logo` | **Yes** (when `slotName` passed) | Slot URL in code |

Chat upload APIs write to `FileUploadService` storage. Slot updates go through `MediaManifestService` (`updateSlotWithUpload`, `importSlot`, or Getty/logo tools). There is **no automatic bridge** from chat upload → manifest on upload alone.

This aligns with the ticket symptoms: without a slot, the image editor and Media Panel have nothing to bind to; the agent has no slot URL to place in code; the file only exists in ephemeral chat upload storage.

---

## Skills — user-provided images

No skill is dedicated to “user uploaded an image in chat → register it in a media slot.”

| Skill / prompt | Mentions user upload? | Slot behavior |
|----------------|----------------------|---------------|
| **media-image** | No — AI generate/edit only | Assigns slot when `slotName` passed on `generate_image` |
| **media-logo** | Yes — as **`referenceUrl`** for inspiration | Generates logo into logo slots; does not import raw chat file as slot image |
| **media** (tool, not a skill) | No | Getty/video search into named slot |
| **initial / file-upload** template | Yes — classification + handoff | Directs develop to **`/assets/{filename}`**, not slot URLs |
| **develop / core.md** | Yes — “When user uploads files…” | Copy to **`public/assets/…`**; table row says “User uploaded file → UI handles slot updates automatically” |

The develop prompt’s “UI handles slot updates automatically” refers to the **Media Manager UI** (user picks a chat file inside a slot detail view). It does **not** mean chat upload alone creates or updates a slot.

---

## Agent guidance conflict

Two parallel models exist for chat images:

1. **Slot model** (Media Panel, publish-safe): `/airo-assets/images/{slot}` + manifest
2. **Static asset model** (develop + file-upload handoff): copy upload to `public/assets/{name}` → `<img src="/assets/…">`

Initial/file-upload flow explicitly uses the static asset model for logos (`assetRole: logo` → `/assets/{filename}`). Develop agent file-handling rules use the same pattern for generic uploads.

Neither path tells the agent to call `apply-upload`, `importSlot`, or create a slot for a chat photo the user wants on the site.

---

## Conclusions

1. **Chat upload does not assign image slots by design today.** Upload storage and the slot manifest are disconnected until Media Manager, edit-mode import, or an agent tool updates the manifest.

2. **No skill documents chat-upload → slot assignment.** The closest coverage is `media-logo` using chat files as generation input, not as the placed site image.

3. **Develop and initial prompts steer chat images away from slots** toward `public/assets/` static paths, which bypasses the Media Panel and slot URL conventions used elsewhere.

4. **The Media Manager path works but is user-driven:** applying a chat file to a slot requires an **existing** slot and explicit action in the UI (`apply-upload` API).

5. **The reported behavior matches the current architecture.** The gap is a missing workflow for “I uploaded this in chat — put it on my site in a slot,” which explains editor failures, agent placement misses, and images appearing lost outside the slot system.

---

## Code references

- Chat upload storage: `agents/src/services/FileUploadService.ts`
- Apply chat file to slot (UI): `POST /media/:appId/slots/:slotName/apply-upload` — `agents/src/server/routes/media.ts`
- Import URL as new slot (edit mode): `POST /media/:appId/slots/import` — `agents/src/server/routes/media.ts`
- Upload classification: `agents/src/services/renderers/FileUploadContextRenderer.ts`
- Develop file rules: `agents/src/prompts/develop/core.md` (File Handling, Media section)
- File-upload handoff: `agents/src/prompts/initial/templates/file-upload/upload-context.md`
- Logo reference from chat: `agents/src/skills/media-logo/skill.md`
