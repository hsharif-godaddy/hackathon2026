# Manual Image Editor — Design Spec

**JIRA:** AIROBUILD-1406  
**Date:** 2026-04-23  
**Branch:** AIROBUILD-1406--manual-image-editor

---

## Goal

Add a client-side manual image editor to Edit mode so users can crop, flip, and adjust color on images without triggering the AI pipeline. Reduces token consumption for simple image operations.

---

## Approach

Use `react-filerobot-image-editor` loaded lazily via `next/dynamic({ ssr: false })`. The editor lives as a third sub-view inside the existing MediaPanel (left chat pane), not a separate tab or modal.

---

## Navigation Structure

MediaPanel gains a third view:

```
Grid View
  → SlotDetail View        (existing — back goes to Grid)
      → ImageEditor View   (new — back goes to SlotDetail)
```

State in `MediaPanel`: existing `activeSlotName` + new `isEditorOpen: boolean`.  
When the editor is open, the chat pane expands to wide mode (616px).

---

## Entry Points

### 1. MediaSlotDetail — "Modify" button

A new "Modify" button added to the actions row in `MediaSlotDetail` (alongside Upload and Use Image). Only shown when the slot has a current image. Calls an `onEdit()` callback prop (new), which `MediaPanel` handles by setting `isEditorOpen = true`.

### 2. Preview hover overlay — "Modify" button

A "Modify" button added next to the existing "Replace" and AI sparkle buttons on image hover in Edit mode. Sends a new postMessage type `OPEN_IMAGE_EDITOR` with `{ slotName }` to the parent app. Handled in `page.tsx` → navigates to the MEDIAS tab, opens the slot, and goes directly to editor view.

---

## Components

### New: `ImageEditorPanel`

**File:** `app/src/app/[market]/develop/components/media/ImageEditorPanel.tsx`

```
'use client'
Props: { appId, slotName, imageUrl, onDone, onCancel }

const FilerobotImageEditor = dynamic(
  () => import('react-filerobot-image-editor'),
  { ssr: false, loading: () => <Skeleton /> }
)

Tabs: ADJUST + TRANSFORM
(brightness, contrast, saturation, hue, crop, flip, rotate)

onSave(editedImage) → blob → upload → onDone()
onClose() → onCancel()
```

### Modified: `MediaSlotDetail`

- New `onEdit?: () => void` prop
- New "Modify" button in the actions row (secondary design, shown when slot has a current image)

### Modified: `MediaPanel`

- New `isEditorOpen: boolean` state
- When `openEditorForSlot` flag is set in store → navigate directly to editor view
- Renders `ImageEditorPanel` when `isEditorOpen`
- Expands to wide mode when editor is open; restores on back

### Modified: `useMediaSlotDialogStore`

- New `openEditorForSlot: boolean` field
- `navigateToSlot(slotName, { openEditor?: boolean })` — extended signature

### Modified: `page.tsx`

- New `OPEN_IMAGE_EDITOR` case in the `handleMessage` switch:
  ```ts
  case 'OPEN_IMAGE_EDITOR':
    if (event.data.slotName && appId) {
      useMediaSlotDialogStore.getState().navigateToSlot(event.data.slotName, { openEditor: true })
      useDevelopPageStore.getState().setActiveChatTab(ChatTab.MEDIAS)
      if (develop.isMobile) develop.handleMobileModeChange(MobileMode.TOOLS)
    }
    break
  ```

### Modified: Preview hover overlay (location TBD during implementation)

- "Modify" button added next to "Replace"
- Sends `window.parent.postMessage({ type: 'OPEN_IMAGE_EDITOR', slotName }, '*')`

---

## Save Flow

On "Apply" in the editor:

1. `react-filerobot-image-editor` `onSave` callback provides a blob/base64
2. Convert to `File` (e.g., `edited-{sanitized-slotName}.jpeg`)
3. `POST /media/{appId}/slots/{slotName}/upload` — same endpoint as manual upload
4. This creates a new asset file and updates the slot URL (works for both uploaded images and Getty images — no distinction needed on the frontend)
5. `postMessageToIframe` → `RELOAD_MEDIA_SLOT` to refresh preview
6. Refetch slot + manifest
7. Navigate back to SlotDetail view

---

## Package

```
react-filerobot-image-editor
```

Install in `app/` workspace. Must be wrapped with `next/dynamic({ ssr: false })` — mandatory for Next.js App Router (Canvas API not available server-side).

---

## i18n Keys (New)

| Key                                    | English Value                 | Where Used                              |
| -------------------------------------- | ----------------------------- | --------------------------------------- |
| `builder_mediaslot_modify`             | "Modify"                      | Hover overlay button, SlotDetail button |
| `builder_mediaslot_edit_image`         | "Edit Image"                  | ImageEditorPanel heading                |
| `builder_mediaslot_editor_saving`      | "Saving..."                   | Spinner while uploading edited image    |
| `builder_mediaslot_editor_save_failed` | "Failed to save edited image" | Error on upload failure                 |

Reused existing keys: `builder_common_cancel` (Cancel), `builder_common_back` (Back).

---

## Out of Scope

- Server-side cleanup of overwritten assets
- Undo/redo history persisted across sessions
- AI-based image editing flow (unchanged)
- PaaS product (AAB only — image slots are AAB-specific)
