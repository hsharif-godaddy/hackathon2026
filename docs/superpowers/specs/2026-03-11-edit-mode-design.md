# Edit Mode for Dev Tools

## Overview

A new persistent edit mode in the dev-tools preview iframe that enables direct text editing and image management without the current select-then-act toolbar flow. Implemented as a parallel system alongside the existing select mode, allowing incremental rollout and A/B testing.

## Goals

- Click any text element and immediately start editing inline
- Hover any image to see a floating action bar with "Replace" and "Edit with AI"
- Stay in edit mode across multiple edits (persistent, not one-shot)
- Support image replacement for all URL types by auto-importing into airo-media.json slots
- No changes to existing select mode or ElementEditor toolbar

## Architecture

### New System (Edit Mode)

Edit mode is a new, parallel system inside `app-templates/v8/dev-tools/`. It coexists with the existing `useDevelopmentMode` + `ElementEditor` without modifying them.

Components:

| Component          | Location                                            | Purpose                                                                    |
| ------------------ | --------------------------------------------------- | -------------------------------------------------------------------------- |
| `useEditMode` hook | `dev-tools/src/hooks/useEditMode.ts`                | Core state machine: text editing, image hover detection, save coordination |
| `ImageHoverBar`    | `dev-tools/src/components/ImageHoverBar.tsx`        | Floating frosted-glass bar on image hover                                  |
| Edit mode toggle   | `app/src/app/develop/[id]/page.tsx` (parent chrome) | Toggle button, on by default, sends postMessages to iframe                 |
| `importSlot()`     | `agents/src/services/MediaManifestService.ts`       | Creates airo-media.json slot from arbitrary image URL                      |
| Import endpoint    | `agents/src/routes/` (media routes)                 | `POST /api/media/slots/import`                                             |

### Relationship to Existing System

- `useDevelopmentMode.ts` — **untouched**
- `ElementEditor.tsx` — **untouched**
- `MediaSlotDialog.tsx` — **reused as-is**
- `useMediaSlotDialogStore.ts` — **reused as-is**

### Mutual Exclusion with Select Mode

When edit mode is active, it must suppress the existing select mode's event handlers. The mechanism:

1. `DevelopmentMode.tsx` passes an `isEditModeActive` boolean to `useDevelopmentMode`
2. When `isEditModeActive` is true, `useDevelopmentMode` skips all `mouseover` and `click` handlers (early return at the top of each handler)
3. This is the only change to `useDevelopmentMode` — a single guard check, not a behavioral change
4. When edit mode is toggled off, select mode resumes normally

This avoids both systems fighting over the same DOM events. The edit mode hook registers its own listeners independently.

### Message Listener Ownership

`EDIT_MODE_ENABLED` / `EDIT_MODE_DISABLED` messages are handled by the existing message listener in `DevelopmentMode.tsx` (which already handles `RELOAD_MEDIA_SLOT`, `REQUEST_VISUAL_CONTEXT`, etc.). The handler sets a state flag that is passed to both `useEditMode` (to activate) and `useDevelopmentMode` (to suppress). `useEditMode` does not register its own `window.addEventListener('message', ...)` for mode toggling.

## Feature 1: Click-to-Edit Text

### Flow

1. User clicks a text element (headings, paragraphs, spans, buttons, links, list items)
2. Element immediately becomes `contentEditable` with focus
3. Subtle visual indicator: 1px blue dashed border
4. User types changes
5. Changes saved on exit (see Save Triggers below)

### Element Filtering

Not everything is text-editable. Skip:

- Images, SVGs, iframes
- Elements that only contain block-level children (containers/wrappers)
- Elements inside the dev-tools overlay itself

Use similar logic to the existing `isTextEditable` check in `useDevelopmentMode`.

### Save Triggers (priority order)

1. **Blur** (click away or click another text element) — saves immediately, sends `TEXT_UPDATED` to parent
2. **Enter** on single-line elements (h1-h6, spans, buttons) — saves and exits editing
3. **Enter** on multi-line elements (p, li, div with text) — inserts newline as normal
4. **Debounce safety net** (8 seconds of no typing) — sends `TEXT_UPDATED` to parent while element stays `contentEditable`. Timer resets on each keystroke. If the user types again after an auto-save, the debounce starts fresh for the next 8 seconds
5. **Escape** — reverts to original text, no save

### Save Feedback

Brief inline "Saved" text appears near the element's top-right corner, fades in and out over ~1.5s. No toast or modal.

### Chaining

Clicking from one text element to another:

1. Saves the current element (blur trigger)
2. Immediately starts editing the new element
3. No intermediate state

### Original Content Capture

On entering edit mode for an element, store the original `innerHTML` (to preserve inline formatting like `<strong>`, `<em>`, `<br>`) so Escape can revert cleanly. Also store the original `textContent` as `oldText` for the `TEXT_UPDATED` message payload, matching the existing contract.

## Feature 2: Image Hover Bar

### Appearance

White frosted-glass bar matching this design language:

- Background: `rgba(255, 255, 255, 0.85)` with `backdrop-filter: blur(12px)`
- Outer container: 6px padding, 12px border-radius, subtle box shadow
- Two buttons inside, each with white background, 8px/14px padding, 8px border-radius
- Icons: 18px lucide-style stroke icons in `#1f2937`
- Labels: 13px, font-weight 600, `#1f2937`
- Buttons: "Replace" (image icon) and "Edit with AI" (sparkle/wand icon)

### Positioning

- **Default**: fixed position, top-right corner of image bounding rect, 12px inset from top and right edges
- **Small images** (< 120px wide or < 80px tall): bar floats above the image instead of overlapping

### Hover Detection

`useEditMode` listens for `mouseover` events on the document. Uses the same `isImageElement` detection logic from `ElementEditor`:

- `<img>` elements
- Elements with CSS `background-image`
- Elements containing an `<img>` child
- Sibling/parent background image patterns

### Show/Hide Timing

- **Show**: immediately on mouse enter
- **Hide**: 300ms delay after mouse leaves both the image element and the bar itself (prevents flicker when moving cursor to bar)

### Button Behavior

**Replace:**

1. Check if image URL is an existing media slot (`/airo-assets/images/...` pattern)
2. If media slot: send `OPEN_MEDIA_SLOT_DIALOG` with slot path (existing flow)
3. If not a media slot: send `AUTO_IMPORT_MEDIA_SLOT` to parent → parent creates slot → parent opens media dialog

**Edit with AI:**

1. Capture element screenshot via `html-to-image`
2. Generate precise nth-child selector
3. Send `REPLACE_IMAGE` to parent with screenshot, selector, dev context, image info (existing flow)
4. Hide bar after click

### Interaction with Text Editing

If user is editing text inline and hovers an image, the hover bar still appears. Clicking a bar button triggers a blur on the text element (saving it) before executing the image action.

## Feature 3: Auto-Import Media Slots

### Problem

Currently, "Swap Media" only works for images already in `airo-media.json` (URLs matching `/airo-assets/images/{slotPath}`). Non-slot images (external URLs, local paths, data URIs) get "Replace Image" which goes through an AI flow instead of the media browser.

### Solution

Auto-create an `airo-media.json` slot from any image URL, then open the existing media slot dialog.

### Flow

1. Dev-tools detects non-slot image, sends `AUTO_IMPORT_MEDIA_SLOT` to parent:

   ```typescript
   {
     type: 'AUTO_IMPORT_MEDIA_SLOT',
     imageUrl: string,       // current image URL (any format)
     devContext: {
       fileName: string,
       componentName: string,
       lineNumber: number
     },
     imageType: 'img' | 'background'
   }
   ```

2. Parent calls `POST /api/media/slots/import` on agents API:

   ```typescript
   // Request
   { imageUrl: string, devContext: DevContext, appId: string }

   // Response
   { slotPath: string }  // e.g., "pages/index/hero-section"
   ```

3. Agents `MediaManifestService.importSlot()`:

   - Generates slot path from dev context (see naming rules)
   - Creates slot entry in `airo-media.json` with `currentUrl` set to the original URL and the URL as the first entry in `alternatives`
   - Returns the new slot path

4. Parent opens `MediaSlotDialog` with the new slot path — existing flow from here.

### Error Handling

If `POST /api/media/slots/import` fails:

1. **Network error / 5xx**: show a brief error toast in the parent chrome ("Couldn't import image. Try again.") and do nothing else. Do not fall back to AI replacement silently.
2. **Invalid URL / unreachable image**: the slot is still created (the URL is stored as-is). The media dialog will show the slot but the thumbnail may be broken. This is acceptable — the user is replacing the image anyway.
3. **Manifest lock contention**: `MediaManifestService` already handles lock retries. If it ultimately fails, return 503 and surface the retry toast.

### Imported Slot Shape

When `importSlot()` creates a new `MediaSlot` entry in `airo-media.json`:

```typescript
{
  mediaType: 'image',
  currentUrl: imageUrl,           // the original URL as-is
  searchQuery: '',                // empty — user hasn't searched yet
  alternatives: [imageUrl],   // string[] to match existing MediaSlot type
  userModified: false,
  createdAt: new Date().toISOString(),
  lastUpdated: new Date().toISOString()
}
```

### Slot Path Derivation Rules

1. Extract page from fileName: `src/frontend/pages/about.page.tsx` → `pages/about`
2. Kebab-case the component name: `HeroSection` → `hero-section`
3. Combine: `pages/about/hero-section`
4. If duplicate exists in manifest, append counter: `pages/about/hero-section-2`
5. Fallback if no dev context: `imported/image-{timestamp}`

### Code Update

The image URL in the source code does not change during import. When the user picks a replacement in the media dialog, the existing replacement flow updates both the slot and the code reference.

## PostMessage API

### Parent → Iframe

| Message              | Payload | Purpose                                         |
| -------------------- | ------- | ----------------------------------------------- |
| `EDIT_MODE_ENABLED`  | `{}`    | Activate edit mode                              |
| `EDIT_MODE_DISABLED` | `{}`    | Deactivate edit mode, save any in-progress edit |

### Iframe → Parent (reused)

| Message                  | Payload                                                 | Purpose                              |
| ------------------------ | ------------------------------------------------------- | ------------------------------------ |
| `TEXT_UPDATED`           | selector, preciseSelector, oldText, newText, devContext | Save text change to disk             |
| `OPEN_MEDIA_SLOT_DIALOG` | slotName                                                | Open media browser for existing slot |
| `REPLACE_IMAGE`          | elementInfo, devContext, screenshot, imageInfo          | AI image replacement flow            |

### Iframe → Parent (new)

| Message                  | Payload                         | Purpose                             |
| ------------------------ | ------------------------------- | ----------------------------------- |
| `AUTO_IMPORT_MEDIA_SLOT` | imageUrl, devContext, imageType | Request slot creation + open dialog |

## State

### `useEditMode` Hook State

```typescript
interface EditModeState {
  isEditModeActive: boolean; // controlled by parent postMessages
  editingElement: HTMLElement | null; // currently text-editing element
  originalContent: string | null; // stored on edit start for Escape revert
  saveStatus: "idle" | "saving" | "saved"; // drives inline "Saved" indicator
  debounceTimer: NodeJS.Timeout | null; // 8-second safety net
  hoveredImage: {
    element: HTMLElement; // live reference — use element.getBoundingClientRect() for positioning (not a stale snapshot)
    imageUrl: string;
    isMediaSlot: boolean;
    slotPath: string | null;
  } | null; // drives ImageHoverBar — ImageHoverBar reads rect live from element ref on each render
}
```

### Parent `/develop` Page State

- `isEditModeEnabled: boolean` — toggle state, defaults to `true`
- Existing `useMediaSlotDialogStore` — reused for media dialog

## File Changes

### New Files

| File                                                          | Purpose                   |
| ------------------------------------------------------------- | ------------------------- |
| `app-templates/v8/dev-tools/src/hooks/useEditMode.ts`         | Core edit mode hook       |
| `app-templates/v8/dev-tools/src/components/ImageHoverBar.tsx` | Floating image action bar |

### Modified Files

| File                                                            | Change                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `app-templates/v8/dev-tools/src/components/DevelopmentMode.tsx` | Mount `useEditMode`, render `ImageHoverBar`                                  |
| `app-templates/v8/dev-tools/src/types.ts`                       | Add new message type interfaces                                              |
| `app/src/app/develop/[id]/page.tsx`                             | Edit mode toggle, postMessage send/receive, `AUTO_IMPORT_MEDIA_SLOT` handler |
| `agents/src/services/MediaManifestService.ts`                   | Add `importSlot()` method                                                    |
| `agents/src/routes/` (media routes)                             | Add `POST /api/media/slots/import` endpoint                                  |

### Minimally Modified Files

| File                                                         | Change                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| `app-templates/v8/dev-tools/src/hooks/useDevelopmentMode.ts` | Add `isEditModeActive` guard check to skip click/hover handlers |

### Untouched Files

| File                                                          | Reason                     |
| ------------------------------------------------------------- | -------------------------- |
| `app-templates/v8/dev-tools/src/components/ElementEditor.tsx` | Existing toolbar preserved |
| `app/src/app/develop/components/media/MediaSlotDialog.tsx`    | Reused as-is               |

## Edge Cases

- **Clicking non-text elements in edit mode**: no-op, click passes through normally
- **Editing text inside an image container**: text edit takes priority, image hover bar doesn't show for the text element itself
- **Page navigation while editing**: blur fires, triggering save before navigation
- **Rapid clicking between elements**: each blur saves, each click starts new edit — debounce timer resets
- **Edit mode disabled while editing**: saves current edit, exits contentEditable, cleans up state
- **Image with no dev context**: falls back to `imported/image-{timestamp}` slot path
- **Duplicate slot paths**: append counter (`-2`, `-3`, etc.)
