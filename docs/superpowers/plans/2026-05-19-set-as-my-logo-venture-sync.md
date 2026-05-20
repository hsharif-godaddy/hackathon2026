# "Set as my logo" — Square + Horizontal Sync to Venture Home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user picks "Set as my logo" in the logo-designer's final question, automatically generate a square companion of their logo via `media-logo__edit_logo` and push both horizontal and square versions to Venture Home as data-URL postMessages.

**Architecture:** One new server tool (`media-logo__set_venture_logo`) reads the current `logo/horizontal` and `logo/primary` slots and returns both URLs. One new client renderer (`SetVentureLogoToolRenderer`) auto-fires `set-as-logo` postMessages for each. The logo-designer prompt is updated to drive the new option through `edit_logo` → `set_venture_logo` → confirmation reply. Existing `LogoActionsToolRenderer` and post-Step-6d offer button stay untouched.

**Tech Stack:** TypeScript, Vitest, React, `@airo/ai-skills` (skill tool registry, auto-registered via tools/index.ts named exports), Next.js, GoDaddy UXCore, Zod.

**Spec:** `docs/superpowers/specs/2026-05-19-set-as-my-logo-venture-sync-design.md`

---

## File Layout

| Action | Path | Responsibility |
| --- | --- | --- |
| Modify | `agents/src/skills/media-logo/tools/index.ts` | Add `setVentureLogoTool` named export. |
| Create | `agents/src/skills/media-logo/tools/__tests__/set-venture-logo.test.ts` | Unit tests for the new tool. |
| Create | `app/src/app/[market]/develop/components/tool-renderers/SetVentureLogoToolRenderer.tsx` | Auto-fire postMessages, render status text. |
| Create | `app/src/app/[market]/develop/components/tool-renderers/SetVentureLogoToolRenderer.test.tsx` | Unit tests for renderer. |
| Modify | `app/src/app/[market]/develop/components/tool-renderers/index.ts` | Register renderer for `media-logo__set_venture_logo`. |
| Modify | `agents/src/prompts/initial/templates/logo-designer/core.md` | Rename option, update Step 7 response handling. |

Skill tool auto-registration: `packages/ai-skills/src/build-skill-tools.ts` dynamically imports `agents/src/skills/<skill>/tools/index.ts` and registers every named export that satisfies `SkillToolDefinition`. No central registry edit is needed — adding the new export is sufficient.

---

## Task 1: Add `setVentureLogoTool` server tool

**Files:**
- Modify: `agents/src/skills/media-logo/tools/index.ts` (append at end of file, before EOF)
- Test: `agents/src/skills/media-logo/tools/__tests__/set-venture-logo.test.ts`

- [ ] **Step 1: Create the test file with mocks and the first failing test**

Create `agents/src/skills/media-logo/tools/__tests__/set-venture-logo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../../../logging/index.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock MediaManifestService — same pattern as edit-logo.test.ts
const mockGetSlot = vi.fn();
vi.mock('../../../../services/MediaManifestService.js', () => ({
  mediaManifestService: {
    setSlot: vi.fn(),
    getSlot: mockGetSlot,
  },
}));

describe('setVentureLogoTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns horizontal + square URLs when both slots are populated', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/horizontal') {
        return { success: true, slot: { currentUrl: 'https://cdn/h.png' } };
      }
      if (slotPath === 'logo/primary') {
        return { success: true, slot: { currentUrl: 'https://cdn/s.png' } };
      }
      return { success: false };
    });

    const { setVentureLogoTool } = await import('../index.js');

    const result = await setVentureLogoTool.execute(
      {},
      { metadata: { appId: 'app-123' } }
    );

    expect(result).toMatchObject({
      structuredContent: {
        horizontalUrl: 'https://cdn/h.png',
        squareUrl: 'https://cdn/s.png',
      },
    });
    expect(typeof result.text).toBe('string');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @airo/agents test:unit "set-venture-logo"`

Expected: FAIL — module `../index.js` has no export `setVentureLogoTool`.

- [ ] **Step 3: Add `setVentureLogoTool` to `tools/index.ts`**

Append to `agents/src/skills/media-logo/tools/index.ts` (after `offerLogoActionsTool`, before EOF). The tool reads slots, returns structured content. No retries — the slot is a local read.

```ts
// ============================================================================
// Set Venture Logo Tool
// ============================================================================

/**
 * Reads the current horizontal and square logo slot URLs and returns them so
 * the matching client renderer (SetVentureLogoToolRenderer) can post both
 * versions to the Venture Home iframe parent.
 *
 * No-args tool — appId comes from context.metadata. Square logo is expected
 * to live in `logo/primary`; horizontal in `logo/horizontal`. The agent prompt
 * runs `edit_logo({ layout: "square" })` immediately before this tool, so the
 * primary slot reflects the user's currently-selected logo.
 */
export const setVentureLogoTool: SkillToolDefinition = {
  name: 'set_venture_logo',
  description:
    'Sends the current horizontal and square logos to the Venture Home dashboard via the chat-side renderer. ' +
    'Call this only after edit_logo has produced a fresh square version. No arguments required.',
  parameters: z.object({}),
  async execute(_input, context?: unknown) {
    const appId = (context as { metadata?: { appId?: string } })?.metadata?.appId;

    if (!appId) {
      logger.error('skills.media-logo.tools.set_venture_logo.no_app_id');
      return { error: 'Unable to determine app id for set_venture_logo' };
    }

    logger.info('skills.media-logo.tools.set_venture_logo.start', { appId });

    const horizontalResult = await mediaManifestService.getSlot(appId, LOGO_SLOT_PATHS.horizontal);
    const squareResult = await mediaManifestService.getSlot(appId, LOGO_SLOT_PATHS.square);

    const horizontalUrl = horizontalResult.success ? horizontalResult.slot?.currentUrl : undefined;
    const squareUrl = squareResult.success ? squareResult.slot?.currentUrl : undefined;

    if (!horizontalUrl || !squareUrl) {
      logger.warn('skills.media-logo.tools.set_venture_logo.slot_missing', {
        appId,
        hasHorizontal: !!horizontalUrl,
        hasSquare: !!squareUrl,
      });
      return {
        error:
          'Could not find both horizontal and square logos. Generate a logo first, then run edit_logo with layout: "square".',
      };
    }

    logger.info('skills.media-logo.tools.set_venture_logo.success', {
      appId,
      hasHorizontal: true,
      hasSquare: true,
    });

    return {
      text: 'Sent horizontal and square logos to the venture dashboard.',
      structuredContent: { horizontalUrl, squareUrl },
    };
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @airo/agents test:unit "set-venture-logo"`

Expected: PASS — 1 test passing.

- [ ] **Step 5: Add the missing-slot and missing-appId tests**

Append to `set-venture-logo.test.ts` inside the same `describe` block:

```ts
  it('returns error when horizontal slot is missing', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/primary') {
        return { success: true, slot: { currentUrl: 'https://cdn/s.png' } };
      }
      return { success: false };
    });

    const { setVentureLogoTool } = await import('../index.js');
    const result = await setVentureLogoTool.execute({}, { metadata: { appId: 'app-123' } });

    expect(result).toMatchObject({ error: expect.stringContaining('horizontal and square') });
    expect((result as { structuredContent?: unknown }).structuredContent).toBeUndefined();
  });

  it('returns error when square slot is missing', async () => {
    mockGetSlot.mockImplementation(async (_appId: string, slotPath: string) => {
      if (slotPath === 'logo/horizontal') {
        return { success: true, slot: { currentUrl: 'https://cdn/h.png' } };
      }
      return { success: false };
    });

    const { setVentureLogoTool } = await import('../index.js');
    const result = await setVentureLogoTool.execute({}, { metadata: { appId: 'app-123' } });

    expect(result).toMatchObject({ error: expect.stringContaining('horizontal and square') });
  });

  it('returns error when appId is missing from context', async () => {
    const { setVentureLogoTool } = await import('../index.js');
    const result = await setVentureLogoTool.execute({}, { metadata: {} });

    expect(result).toMatchObject({ error: expect.stringContaining('app id') });
    expect(mockGetSlot).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Run all 4 tests to verify they pass**

Run: `pnpm --filter @airo/agents test:unit "set-venture-logo"`

Expected: PASS — 4 tests passing.

- [ ] **Step 7: Run agents typecheck**

Run: `pnpm --filter @airo/agents typecheck`

Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add agents/src/skills/media-logo/tools/index.ts \
        agents/src/skills/media-logo/tools/__tests__/set-venture-logo.test.ts
git commit -m "feat(agents): add media-logo__set_venture_logo passthrough tool"
```

---

## Task 2: Add `SetVentureLogoToolRenderer`

**Files:**
- Create: `app/src/app/[market]/develop/components/tool-renderers/SetVentureLogoToolRenderer.tsx`
- Test: `app/src/app/[market]/develop/components/tool-renderers/SetVentureLogoToolRenderer.test.tsx`

- [ ] **Step 1: Write the failing test file**

Create `app/src/app/[market]/develop/components/tool-renderers/SetVentureLogoToolRenderer.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'

import { getParentOrigin } from '@/components/security/allowed-frame-ancestors'
import { useIsEmbedded } from '@/hooks/useIsEmbedded'
import { renderWithProviders } from '@/tests/test-utils'
import { fetchAsDataUrl } from '@/utils/image'
import SetVentureLogoToolRenderer from './SetVentureLogoToolRenderer'

vi.mock('@/hooks/useIsEmbedded', () => ({
  useIsEmbedded: vi.fn().mockReturnValue(true),
}))

vi.mock('@/components/security/allowed-frame-ancestors', () => ({
  getParentOrigin: vi.fn().mockReturnValue('https://dashboard.godaddy.com'),
}))

vi.mock('@/utils/image', () => ({
  fetchAsDataUrl: vi.fn(),
}))

const completedResult = {
  structuredContent: {
    horizontalUrl: 'https://cdn/h.png',
    squareUrl: 'https://cdn/s.png',
  },
}

describe('SetVentureLogoToolRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useIsEmbedded).mockReturnValue(true)
    vi.mocked(getParentOrigin).mockReturnValue('https://dashboard.godaddy.com')
    vi.mocked(fetchAsDataUrl).mockImplementation(async (url: string) => `data:image/png;base64,${url}`)
  })

  it('returns null when not embedded', () => {
    vi.mocked(useIsEmbedded).mockReturnValue(false)

    const { container } = renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    expect(container.innerHTML).toBe('')
  })

  it('returns null when getParentOrigin is null', () => {
    vi.mocked(getParentOrigin).mockReturnValue(null)

    const { container } = renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    expect(container.innerHTML).toBe('')
  })

  it('returns null when status is not completed', () => {
    const { container } = renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="running"
        result={completedResult}
      />
    )

    expect(container.innerHTML).toBe('')
  })

  it('fires both postMessages with data URLs in horizontal-then-square order when embedded', async () => {
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledTimes(2)
    })

    expect(postMessageSpy.mock.calls[0]).toEqual([
      { action: 'set-as-logo', sender: 'airo-hq', imageUrl: 'data:image/png;base64,https://cdn/h.png' },
      'https://dashboard.godaddy.com',
    ])
    expect(postMessageSpy.mock.calls[1]).toEqual([
      { action: 'set-as-logo', sender: 'airo-hq', imageUrl: 'data:image/png;base64,https://cdn/s.png' },
      'https://dashboard.godaddy.com',
    ])

    postMessageSpy.mockRestore()
  })

  it('fires postMessages exactly once across re-renders', async () => {
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    const { rerender } = renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledTimes(2)
    })

    rerender(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    // Still only 2 calls — no re-fire
    expect(postMessageSpy).toHaveBeenCalledTimes(2)
    postMessageSpy.mockRestore()
  })

  it('drops the variant whose fetchAsDataUrl rejects but still fires the other', async () => {
    vi.mocked(fetchAsDataUrl).mockImplementation(async (url: string) => {
      if (url === 'https://cdn/s.png') throw new Error('fetch failed')
      return `data:image/png;base64,${url}`
    })
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')

    renderWithProviders(
      <SetVentureLogoToolRenderer
        toolName="media-logo__set_venture_logo"
        toolStatus="completed"
        result={completedResult}
      />
    )

    await waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledTimes(1)
    })

    expect(postMessageSpy.mock.calls[0]?.[0]).toMatchObject({
      action: 'set-as-logo',
      imageUrl: expect.stringContaining('data:image/png;base64,https://cdn/h.png'),
    })

    postMessageSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter website test "SetVentureLogoToolRenderer"`

Expected: FAIL — file `./SetVentureLogoToolRenderer` does not exist.

- [ ] **Step 3: Implement the renderer with inline English strings**

The pre-commit i18n validator (`scripts/validate-i18n.mjs`) AST-parses every `t('...')` call and rejects keys missing from the i18n API — the third-arg fallback does NOT bypass it. Ship inline English strings now; Task 6 swaps them to `t()` after the keys are created in the portal.

Create `app/src/app/[market]/develop/components/tool-renderers/SetVentureLogoToolRenderer.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

import type { DefaultToolRendererProps } from '@/app/[market]/develop/components/tool-renderers/DefaultToolRenderer'
import { getParentOrigin } from '@/components/security/allowed-frame-ancestors'
import { useIsEmbedded } from '@/hooks/useIsEmbedded'
import { logger } from '@/lib/request-context'
import { fetchAsDataUrl } from '@/utils/image'
import { logImpressionEvent } from '@/utils/instrumentation'

interface VentureLogoUrls {
  horizontalUrl: string
  squareUrl: string
}

function readUrls(result: unknown): VentureLogoUrls | undefined {
  if (!result || typeof result !== 'object') return undefined
  const sc = (result as { structuredContent?: unknown }).structuredContent
  if (!sc || typeof sc !== 'object') return undefined
  const { horizontalUrl, squareUrl } = sc as Record<string, unknown>
  if (typeof horizontalUrl !== 'string' || typeof squareUrl !== 'string') return undefined
  return { horizontalUrl, squareUrl }
}

// TODO(i18n): once builder_logo_setting_to_venture and builder_logo_set_to_venture
// are published at https://i18n.int.gdcorp.tools/org/hcx/app/aab, swap these
// inline strings for `t(...)` calls — see Task 6 of the implementation plan.
export default function SetVentureLogoToolRenderer({
  toolStatus,
  result,
}: DefaultToolRendererProps) {
  const isEmbedded = useIsEmbedded()
  const firedRef = useRef(false)
  const [phase, setPhase] = useState<'sending' | 'done'>('sending')

  const urls = toolStatus === 'completed' ? readUrls(result) : undefined
  const parentOrigin = isEmbedded ? getParentOrigin() : null

  const shouldRender = !!(urls && parentOrigin)

  useEffect(() => {
    if (!shouldRender || firedRef.current || !urls || !parentOrigin) return
    firedRef.current = true

    logImpressionEvent('develop.brand.logo_set_to_venture', { flow: 'logo-designer' })()

    void (async () => {
      const targets: Array<{ key: 'horizontal' | 'square'; url: string }> = [
        { key: 'horizontal', url: urls.horizontalUrl },
        { key: 'square', url: urls.squareUrl },
      ]

      for (const { key, url } of targets) {
        try {
          const dataUrl = await fetchAsDataUrl(url)
          window.parent.postMessage(
            { action: 'set-as-logo', sender: 'airo-hq', imageUrl: dataUrl },
            parentOrigin
          )
        } catch (err) {
          logger.warn('setVentureLogo.fetchFailed', { variant: key, error: err })
        }
      }

      setPhase('done')
    })()
  }, [shouldRender, urls, parentOrigin])

  if (!shouldRender) return null

  return (
    <div className="my-2">
      <p className="text-sm text-intents-ux-textSubtle-textColor">
        {phase === 'sending'
          ? 'Setting your logo on your dashboard…'
          : 'Logo saved to your dashboard.'}
      </p>
    </div>
  )
}
```

Update the test's "shows confirmation" assertion if you wrote it earlier — text should now be the literal English strings, not translation keys. The five tests in Step 1 do not assert on these strings, so no test edit is required.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter website test "SetVentureLogoToolRenderer"`

Expected: PASS — 5 tests passing.

- [ ] **Step 5: Run app typecheck**

Run: `pnpm --filter website typecheck`

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add app/src/app/\[market\]/develop/components/tool-renderers/SetVentureLogoToolRenderer.tsx \
        app/src/app/\[market\]/develop/components/tool-renderers/SetVentureLogoToolRenderer.test.tsx
git commit -m "feat(app): add SetVentureLogoToolRenderer auto-firing dual postMessages"
```

---

## Task 3: Register the renderer

**Files:**
- Modify: `app/src/app/[market]/develop/components/tool-renderers/index.ts`

- [ ] **Step 1: Add the import and registry entry**

Open `app/src/app/[market]/develop/components/tool-renderers/index.ts`. Insert the import alphabetically (between `RebuildPageSelectorToolRenderer` and `SecretsToolRenderer`):

```ts
import RebuildPageSelectorToolRenderer from './RebuildPageSelectorToolRenderer'
import SecretsToolRenderer from './SecretsToolRenderer'
import SetProjectNameToolRenderer from './SetProjectNameToolRenderer'
import SetVentureLogoToolRenderer from './SetVentureLogoToolRenderer'
```

Add the registry entry inside `toolRendererRegistry` directly after the existing `'media-logo__offer_logo_actions': LogoActionsToolRenderer,` line:

```ts
  'media-logo__offer_logo_actions': LogoActionsToolRenderer,
  'media-logo__set_venture_logo': SetVentureLogoToolRenderer,
```

- [ ] **Step 2: Run app typecheck**

Run: `pnpm --filter website typecheck`

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/app/\[market\]/develop/components/tool-renderers/index.ts
git commit -m "feat(app): register SetVentureLogoToolRenderer for media-logo__set_venture_logo"
```

---

## Task 4: Update logo-designer prompt

**Files:**
- Modify: `agents/src/prompts/initial/templates/logo-designer/core.md` lines 248–267

- [ ] **Step 1: Rename the askQuestion option**

Replace lines 248–258 (the askQuestion code block) so option 4 reads "Set as my logo":

```
askQuestion({
  question: "Your logo and brand identity are ready! What would you like to do next?",
  options: [
    "Edit or refine this logo",
    "Try a different logo style",
    "Build a website with this logo",
    "Set as my logo"
  ]
})
```

- [ ] **Step 2: Replace the response handler bullets for the renamed option**

Replace lines 260–266 with:

```
Wait for the user's response:

- **Edit or refine this logo** → use the `media-logo__edit_logo` tool (see Logo Editing below)
- **Try a different logo style** → use `media-logo__generate_logo` with a new style variation, then ask again
- **Build a website with this logo** → hand off to the `initial` agent to build a website that uses the current brand identity and logo
- **Set as my logo** → run the venture-sync sequence:
  1. Call `media-logo__edit_logo({ prompt: "Reformat for a square layout, preserving the existing design and content.", layout: "square", count: 1 })` to produce a square companion of the current logo. The tool auto-resolves the source from the slot.
  2. If `edit_logo` returns an `error`, surface it to the user and offer to retry. Do NOT call `set_venture_logo` in that case.
  3. On success, call `media-logo__set_venture_logo({})`.
  4. Reply with one short message: "Logo set! You can close this window — your dashboard will now show the new logo."
- **Anything else outside brand/logo scope** (e.g., "buy a domain") → hand off to the initial agent
```

- [ ] **Step 3: Verify the file still parses by running the prompt loader unit tests (or the agents unit suite at minimum)**

Run: `pnpm --filter @airo/agents test:unit "logo-designer"` if such tests exist, otherwise `pnpm --filter @airo/agents test:unit "prompt"`.

Expected: PASS or "no tests found" — there are no automated tests guarding the prompt content. A manual read of the surrounding markdown for layout sanity is sufficient.

- [ ] **Step 4: Commit**

```bash
git add agents/src/prompts/initial/templates/logo-designer/core.md
git commit -m "feat(agents): rename final logo-designer option to \"Set as my logo\" and route through edit_logo + set_venture_logo"
```

---

## Task 5: Pre-merge verification

- [ ] **Step 1: Run the full agents unit suite**

Run: `pnpm --filter @airo/agents test:unit`

Expected: PASS, including the new `set-venture-logo` tests.

- [ ] **Step 2: Run the website renderer test suite**

Run: `pnpm --filter website test "tool-renderers"`

Expected: PASS, including the new `SetVentureLogoToolRenderer` tests.

- [ ] **Step 3: Run typecheck and lint at repo root**

Run: `pnpm typecheck && pnpm lint`

Expected: PASS.

- [ ] **Step 4: Manual smoke (only if local dev is feasible)**

1. `pnpm run local:test` (grants/billing requires the local-test env per repo CLAUDE.md).
2. Open the embedded logo-designer flow (or simulate by setting `useIsEmbedded` true in dev).
3. Generate a logo, walk to the final `askQuestion`, pick "Set as my logo".
4. In devtools Network/Console, observe two `postMessage` calls with `action: 'set-as-logo'` and `data:image/...` URLs targeting the parent origin.
5. Confirm the chat shows "Logo saved to your dashboard." and the agent's confirmation reply.
6. Failure path: in a session where `logo/horizontal` is empty, observe the agent surfaces the slot-missing error rather than silently continuing.

- [ ] **Step 5: Push branch**

```bash
git push -u origin feat/save-to-venture-square-logo-GAI-1531
```

---

## Task 6: i18n swap (after keys exist)

This is a follow-up task. Run it once both keys are published at https://i18n.int.gdcorp.tools/org/hcx/app/aab (PARTNERSTRANSLATIONS AD group required). Until then, the renderer ships with inline English strings — pre-commit's `validate-i18n.mjs` rejects unpublished keys regardless of any third-arg fallback, so we cannot route through `t()` until publication.

Keys to create (English values, defaults shown):

| Key | English |
| --- | --- |
| `builder_logo_setting_to_venture` | Setting your logo on your dashboard… |
| `builder_logo_set_to_venture` | Logo saved to your dashboard. |

- [ ] **Step 1: Create both keys in the i18n portal**

Verify availability:

```bash
curl -s 'https://api.i18n.int.gdcorp.tools/api/v2/package/market/en-US/%40airo-app-builder%2Faab' \
  | grep -E 'builder_logo_setting_to_venture|builder_logo_set_to_venture'
```

Expected: both keys present in the response.

- [ ] **Step 2: Switch the renderer to `t()`**

Edit `app/src/app/[market]/develop/components/tool-renderers/SetVentureLogoToolRenderer.tsx`:

Add the import:

```tsx
import { useTranslations } from '@/hooks/useTranslations'
```

Inside the component, after `const isEmbedded = useIsEmbedded()`:

```tsx
  const t = useTranslations()
```

Replace the inline strings in the JSX:

```tsx
        {phase === 'sending'
          ? t('builder_logo_setting_to_venture')
          : t('builder_logo_set_to_venture')}
```

Remove the `TODO(i18n)` comment.

- [ ] **Step 3: Run the renderer tests**

Run: `pnpm --filter website test "SetVentureLogoToolRenderer"`

Expected: PASS — the existing 5 tests do not assert on the rendered text, so no test edit is needed.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/\[market\]/develop/components/tool-renderers/SetVentureLogoToolRenderer.tsx
git commit -m "i18n(app): route SetVentureLogoToolRenderer text through translation keys"
```

---

## Self-Review Checklist (already run inline before save)

- Spec coverage: prompt rename ✓, edit_logo call ✓, set_venture_logo tool ✓, dual postMessage ✓, agent confirmation ✓, no Venture Home edits ✓. Spec's "i18n via `t(key, undefined, 'fallback')` pattern" is corrected here: the pre-commit validator (`scripts/validate-i18n.mjs`) AST-parses `t()` calls and rejects unpublished keys, so Task 2 ships inline English and Task 6 swaps to `t()` once keys are created.
- Placeholder scan: every code step contains complete code, exact paths, exact commands.
- Type consistency: tool name `set_venture_logo` (registers as `media-logo__set_venture_logo`) is consistent across server tool, renderer registry key, prompt instructions, and tests. `horizontalUrl` / `squareUrl` field names match in tool output → renderer reader → tests.
