# Manual AdSense Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the manual AIROBUILD-1711 Display Ads settings surface and publish delivery so Airo users can save Google AdSense configuration and have it applied to the next published site.

**Architecture:** Shared pure validation normalizes the pasted AdSense snippet into a safe publisher ID and canonical script. Agents exposes app-scoped `GET`/`PUT /apps/:id/adsense` routes backed by `.airo/adsense.json` in the preview workspace. The app renders a lazy-loaded `Display Ads` settings panel that reads and saves through `agentFetch`. Publish validates `.airo/adsense.json` again and generates `dist/airo-adsense.json`; the v8 published Express server reads that runtime artifact to append the canonical AdSense script to SSR head output and serve `/ads.txt` plus `/app-ads.txt`.

**Tech Stack:** TypeScript, React, UXCore, React Query, Express, workspace file APIs, Vitest, Vite SSR, generated v8 Express runtime.

**Storage Contract:** `.airo/adsense.json` is the only durable AdSense authoring state. The API creates `.airo/` lazily if absent, treats missing or malformed files as disabled settings, and writes canonical JSON only. `dist/airo-adsense.json` is generated publish output for v8 runtime delivery, not source of truth.

**Pre-Implementation Decision Gate:** CLEARED on 2026-06-04. Approved method: file-backed authoring through `.airo/adsense.json`, publish-generated `dist/airo-adsense.json`, runtime injection from v8 `entry.ts`, and publish-only AdSense delivery. Future manual UI and agent-driven setup must use the same route or file service and shared validation.

---

## File Map

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/shared/src/adsense/types.ts` | Public settings, input, manifest, and field-error types | Create |
| `packages/shared/src/adsense/validation.ts` | Pure AdSense snippet/text-file validation and canonical script generation | Create |
| `packages/shared/src/adsense/index.ts` | Ads exports | Create |
| `packages/shared/src/adsense/__tests__/validation.test.ts` | Shared validation contract tests | Create |
| `packages/shared/src/index.ts` | Root shared exports for app/agents | Modify |
| `packages/shared/package.json` | Export `@airo/shared/adsense` | Modify |
| `agents/src/services/AdSenseSettingsFileService.ts` | Read/write `.airo/adsense.json` through workspace files; missing/malformed means disabled | Create |
| `agents/src/services/__tests__/AdSenseSettingsFileService.test.ts` | File-backed defaults, canonical writes, malformed fail-open behavior | Create |
| `agents/src/services/AdSensePublishManifestService.ts` | Convert `.airo/adsense.json` into generated `dist/airo-adsense.json` | Create |
| `agents/src/services/__tests__/AdSensePublishManifestService.test.ts` | Manifest serialization and workspace write tests | Create |
| `agents/src/server/routes/adsense.ts` | `GET` and `PUT /apps/:id/adsense` | Create |
| `agents/src/server/routes/__tests__/adsense.test.ts` | Route validation, ownership, load/save tests | Create |
| `agents/src/server/routes/index.ts` | Route export | Modify |
| `agents/src/server/app.ts` | Mount adsense route on protected router | Modify |
| `agents/src/server/routes/publish.ts` | Pass an AdSense runtime-manifest hook into the default publish strategy | Modify |
| `agents/src/server/routes/publish.test.ts` | Publish wires the hook and handles manifest-generation failures | Modify |
| `agents/src/server/routes/publish/strategies/PublishStrategy.ts` | Optional post-build/pre-archive hook contract | Modify |
| `agents/src/server/routes/publish/strategies/DefaultPublishStrategy.ts` | Run runtime artifact hooks after build and before archive | Modify |
| `agents/src/server/routes/publish/strategies/__tests__/DefaultPublishStrategy.test.ts` | Hook ordering and failure coverage | Modify |
| `app/src/hooks/useAdSenseSettings.ts` | React Query read/save hooks using `agentFetch` | Create |
| `app/src/app/[market]/develop/components/settings/DisplayAds/useAdSenseSettingsForm.ts` | Local form state, dirty tracking, validation mapping | Create |
| `app/src/app/[market]/develop/components/settings/DisplayAds/DisplayAdsPanel.tsx` | UXCore panel UI | Create |
| `app/src/app/[market]/develop/components/settings/DisplayAds/DisplayAdsPanel.test.tsx` | Panel load, validation, save, toggles, retry tests | Create |
| `app/src/app/[market]/develop/components/types.ts` | Add `SettingsSection.DISPLAY_ADS` | Modify |
| `app/src/app/[market]/develop/components/settings/useSettingsNavItems.tsx` | Add switchboard-gated Display Ads nav item | Modify |
| `app/src/app/[market]/develop/components/settings/useSettingsNavItems.test.tsx` | Nav item coverage | Modify |
| `app/src/app/[market]/develop/components/settings/SettingsMenu.test.tsx` | Menu renders/navigates Display Ads | Modify |
| `app/src/app/[market]/develop/components/settings/SettingsView.tsx` | Lazy-load and render Display Ads panel | Modify |
| `app-templates/v8/src/server/adsense-manifest.ts` | Runtime artifact read, validation, script/head helpers | Create |
| `app-templates/v8/src/server/adsense-manifest.test.ts` | Runtime helper tests | Create |
| `app-templates/v8/src/server/entry.ts` | Serve text routes and append canonical script to SSR head | Modify |
| `app-templates/v8/src/server/entry.test.ts` | Express route coverage for text files and head injection | Create |
| `container-scripts/preview/sync-template-files.js` | Add sync entries/hash for v8 server files | Modify |
| `packages/shared/src/app-structure/index.ts` | Preserve `.airo/adsense.json` in app import/export allowlists | Modify |
| `agents/src/tools/ai-lib-tools/__tests__/text-editor.security.test.ts` | Prove `.airo/adsense.json` is protected from normal text edits | Modify |
| `docs/superpowers/plans/2026-06-03-manual-adsense-integration-design.md` | Design/source-of-truth notes for this settings surface | Created by planning |

---

## Required Implementation Order

Publish delivery is the highest-risk part of AIROBUILD-1711. Execute the plan in this order even though the detailed task sections below keep UI and runtime details separated:

1. Task 1: shared validation contract.
2. Task 2: agents file-backed settings service and settings API.
3. Task 3: publish runtime artifact generation and dist-only archive proof.
4. Task 5: v8 runtime delivery and entry-level head-injection tests.
5. Publish Delivery Gate below: prove `.airo/adsense.json` fixture -> `dist/airo-adsense.json` -> dist archive -> published runtime head/text responses.
6. Task 4: builder Display Ads UI.
7. Task 6: end-to-end verification and cleanup.

Do not start the builder UI task until the Publish Delivery Gate passes.

---

## Shared Validation Contract

Use this core shape across shared, agents, app, and template runtime:

```typescript
export const ADSENSE_MANIFEST_FILENAME = 'airo-adsense.json';
export const ADSENSE_AUTHORING_CONFIG_PATH = '.airo/adsense.json';
export const ADSENSE_RUNTIME_MANIFEST_PATH = 'dist/airo-adsense.json';
export const ADSENSE_TEXT_MAX_BYTES = 100 * 1024;
export const ADSENSE_PUBLISHER_ID_PATTERN = /^ca-pub-\d{16}$/;

export interface AdSenseTextFileSettings {
  enabled: boolean;
  content: string;
}

export interface AdSenseSettings {
  publisherId: string | null;
  scriptSnippet: string;
  adsTxt: AdSenseTextFileSettings;
  appAdsTxt: AdSenseTextFileSettings;
  updatedAt: string | null;
}

export interface AdSenseSettingsInput {
  scriptSnippet?: string;
  adsTxt?: Partial<AdSenseTextFileSettings>;
  appAdsTxt?: Partial<AdSenseTextFileSettings>;
}

export interface AdSensePublishManifest {
  version: 1;
  publisherId: string | null;
  scriptSnippet: string;
  adsTxt: AdSenseTextFileSettings;
  appAdsTxt: AdSenseTextFileSettings;
}
```

Canonical script output:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>
```

---

### Task 1: Shared AdSense Validation

**Files:**
- Create: `packages/shared/src/adsense/types.ts`
- Create: `packages/shared/src/adsense/validation.ts`
- Create: `packages/shared/src/adsense/index.ts`
- Create: `packages/shared/src/adsense/__tests__/validation.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Write failing validation tests**

Create `packages/shared/src/adsense/__tests__/validation.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import {
  ADSENSE_TEXT_MAX_BYTES,
  buildCanonicalAdSenseScript,
  normalizeAdSenseSettingsInput,
  parseAdSensePublisherIdFromSnippet,
} from '../index.js';

const publisherId = 'ca-pub-1234567890123456';
const canonical = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>';

describe('adsense validation', () => {
  it('extracts the publisher id from a Google AdSense script tag', () => {
    expect(parseAdSensePublisherIdFromSnippet(canonical)).toEqual({
      ok: true,
      publisherId,
    });
  });

  it('rejects non-script markup even when it contains a src attribute', () => {
    expect(parseAdSensePublisherIdFromSnippet('<img src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456">')).toEqual({
      ok: false,
      error: 'Paste the full AdSense script tag from Google.',
    });
  });

  it('rejects scripts that do not load from the expected Google domain', () => {
    expect(parseAdSensePublisherIdFromSnippet('<script src="https://example.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456"></script>')).toEqual({
      ok: false,
      error: 'AdSense script must load from pagead2.googlesyndication.com.',
    });
  });

  it('rejects malformed publisher ids', () => {
    expect(parseAdSensePublisherIdFromSnippet('<script src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-123"></script>')).toEqual({
      ok: false,
      error: 'AdSense publisher ID must look like ca-pub-1234567890123456.',
    });
  });

  it('builds the canonical script from a safe publisher id', () => {
    expect(buildCanonicalAdSenseScript(publisherId)).toBe(canonical);
  });

  it('normalizes empty script input and disabled text files', () => {
    expect(normalizeAdSenseSettingsInput({
      scriptSnippet: '   ',
      adsTxt: { enabled: false, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: false, content: '' },
    })).toEqual({
      ok: true,
      value: {
        publisherId: null,
        scriptSnippet: '',
        adsTxt: { enabled: false, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: false, content: '' },
      },
    });
  });

  it('requires enabled text files to have content', () => {
    expect(normalizeAdSenseSettingsInput({
      scriptSnippet: canonical,
      adsTxt: { enabled: true, content: ' ' },
      appAdsTxt: { enabled: false, content: '' },
    })).toEqual({
      ok: false,
      errors: {
        adsTxt: 'ads.txt content is required when enabled.',
      },
    });
  });

  it('limits each text file to 100KB', () => {
    const tooLarge = 'a'.repeat(ADSENSE_TEXT_MAX_BYTES + 1);
    expect(normalizeAdSenseSettingsInput({
      scriptSnippet: canonical,
      adsTxt: { enabled: true, content: tooLarge },
      appAdsTxt: { enabled: true, content: tooLarge },
    })).toEqual({
      ok: false,
      errors: {
        adsTxt: 'ads.txt content must be 100KB or smaller.',
        appAdsTxt: 'app-ads.txt content must be 100KB or smaller.',
      },
    });
  });
});
```

- [ ] **Step 2: Run shared test and verify red**

Run: `pnpm --filter @airo/shared test -- src/adsense/__tests__/validation.test.ts`

Expected: FAIL with `Cannot find module '../index.js'`.

- [ ] **Step 3: Implement shared types**

Create `packages/shared/src/adsense/types.ts`:

```typescript
export const ADSENSE_MANIFEST_FILENAME = 'airo-adsense.json';
export const ADSENSE_AUTHORING_CONFIG_PATH = '.airo/adsense.json';
export const ADSENSE_RUNTIME_MANIFEST_PATH = `dist/${ADSENSE_MANIFEST_FILENAME}`;
export const ADSENSE_TEXT_MAX_BYTES = 100 * 1024;
export const ADSENSE_PUBLISHER_ID_PATTERN = /^ca-pub-\d{16}$/;

export interface AdSenseTextFileSettings {
  enabled: boolean;
  content: string;
}

export interface AdSenseSettings {
  publisherId: string | null;
  scriptSnippet: string;
  adsTxt: AdSenseTextFileSettings;
  appAdsTxt: AdSenseTextFileSettings;
  updatedAt: string | null;
}

export interface AdSenseSettingsInput {
  scriptSnippet?: string;
  adsTxt?: Partial<AdSenseTextFileSettings>;
  appAdsTxt?: Partial<AdSenseTextFileSettings>;
}

export interface AdSenseSettingsWrite {
  publisherId: string | null;
  scriptSnippet: string;
  adsTxt: AdSenseTextFileSettings;
  appAdsTxt: AdSenseTextFileSettings;
}

export interface AdSensePublishManifest {
  version: 1;
  publisherId: string | null;
  scriptSnippet: string;
  adsTxt: AdSenseTextFileSettings;
  appAdsTxt: AdSenseTextFileSettings;
}

export type AdSenseFieldName = 'scriptSnippet' | 'adsTxt' | 'appAdsTxt';
export type AdSenseValidationErrors = Partial<Record<AdSenseFieldName, string>>;

export type AdSenseParseResult =
  | { ok: true; publisherId: string }
  | { ok: false; error: string };

export type AdSenseNormalizeResult =
  | { ok: true; value: AdSenseSettingsWrite }
  | { ok: false; errors: AdSenseValidationErrors };
```

- [ ] **Step 4: Implement shared validation**

Create `packages/shared/src/adsense/validation.ts`:

```typescript
import {
  ADSENSE_PUBLISHER_ID_PATTERN,
  ADSENSE_TEXT_MAX_BYTES,
  type AdSenseNormalizeResult,
  type AdSenseParseResult,
  type AdSenseSettingsInput,
  type AdSenseTextFileSettings,
  type AdSenseValidationErrors,
} from './types.js';

const ADSENSE_SCRIPT_HOST = 'pagead2.googlesyndication.com';
const ADSENSE_SCRIPT_PATH = '/pagead/js/adsbygoogle.js';

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function buildCanonicalAdSenseScript(publisherId: string): string {
  if (!ADSENSE_PUBLISHER_ID_PATTERN.test(publisherId)) {
    throw new Error('Invalid AdSense publisher ID.');
  }

  return `<script async src="https://${ADSENSE_SCRIPT_HOST}${ADSENSE_SCRIPT_PATH}?client=${publisherId}" crossorigin="anonymous"></script>`;
}

export function parseAdSensePublisherIdFromSnippet(snippet: string): AdSenseParseResult {
  const trimmed = snippet.trim();
  if (!trimmed) {
    return { ok: false, error: 'AdSense script snippet is empty.' };
  }

  if (!/^<script\b[\s\S]*>\s*<\/script>$/i.test(trimmed)) {
    return { ok: false, error: 'Paste the full AdSense script tag from Google.' };
  }

  const srcMatch = trimmed.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  if (!srcMatch?.[1]) {
    return { ok: false, error: 'Paste the full AdSense script tag from Google.' };
  }

  let url: URL;
  try {
    url = new URL(srcMatch[1]);
  } catch {
    return { ok: false, error: 'AdSense script source is not a valid URL.' };
  }

  if (url.hostname !== ADSENSE_SCRIPT_HOST || url.pathname !== ADSENSE_SCRIPT_PATH) {
    return { ok: false, error: 'AdSense script must load from pagead2.googlesyndication.com.' };
  }

  const publisherId = url.searchParams.get('client') ?? '';
  if (!ADSENSE_PUBLISHER_ID_PATTERN.test(publisherId)) {
    return { ok: false, error: 'AdSense publisher ID must look like ca-pub-1234567890123456.' };
  }

  return { ok: true, publisherId };
}

function normalizeTextFile(
  label: 'ads.txt' | 'app-ads.txt',
  input: Partial<AdSenseTextFileSettings> | undefined,
): { value: AdSenseTextFileSettings; error?: string } {
  const enabled = input?.enabled === true;
  const content = input?.content ?? '';

  if (content.includes('\0')) {
    return { value: { enabled, content }, error: `${label} content cannot contain null bytes.` };
  }

  if (enabled && content.trim().length === 0) {
    return { value: { enabled, content }, error: `${label} content is required when enabled.` };
  }

  if (byteLength(content) > ADSENSE_TEXT_MAX_BYTES) {
    return { value: { enabled, content }, error: `${label} content must be 100KB or smaller.` };
  }

  return { value: { enabled, content } };
}

export function normalizeAdSenseSettingsInput(input: AdSenseSettingsInput): AdSenseNormalizeResult {
  const errors: AdSenseValidationErrors = {};
  const rawSnippet = input.scriptSnippet ?? '';
  const trimmedSnippet = rawSnippet.trim();
  let publisherId: string | null = null;
  let scriptSnippet = '';

  if (trimmedSnippet) {
    const parsed = parseAdSensePublisherIdFromSnippet(trimmedSnippet);
    if (parsed.ok) {
      publisherId = parsed.publisherId;
      scriptSnippet = buildCanonicalAdSenseScript(parsed.publisherId);
    } else {
      errors.scriptSnippet = parsed.error;
    }
  }

  const adsTxt = normalizeTextFile('ads.txt', input.adsTxt);
  if (adsTxt.error) errors.adsTxt = adsTxt.error;

  const appAdsTxt = normalizeTextFile('app-ads.txt', input.appAdsTxt);
  if (appAdsTxt.error) errors.appAdsTxt = appAdsTxt.error;

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      publisherId,
      scriptSnippet,
      adsTxt: adsTxt.value,
      appAdsTxt: appAdsTxt.value,
    },
  };
}
```

- [ ] **Step 5: Export the shared module**

Create `packages/shared/src/adsense/index.ts`:

```typescript
export * from './types.js';
export {
  buildCanonicalAdSenseScript,
  normalizeAdSenseSettingsInput,
  parseAdSensePublisherIdFromSnippet,
} from './validation.js';
```

Modify `packages/shared/src/index.ts`:

```typescript
// AdSense
export type {
  AdSenseFieldName,
  AdSenseNormalizeResult,
  AdSenseParseResult,
  AdSensePublishManifest,
  AdSenseSettings,
  AdSenseSettingsInput,
  AdSenseSettingsWrite,
  AdSenseTextFileSettings,
  AdSenseValidationErrors,
} from './adsense/index.js';
export {
  ADSENSE_AUTHORING_CONFIG_PATH,
  ADSENSE_MANIFEST_FILENAME,
  ADSENSE_PUBLISHER_ID_PATTERN,
  ADSENSE_RUNTIME_MANIFEST_PATH,
  ADSENSE_TEXT_MAX_BYTES,
  buildCanonicalAdSenseScript,
  normalizeAdSenseSettingsInput,
  parseAdSensePublisherIdFromSnippet,
} from './adsense/index.js';
```

Modify `packages/shared/package.json` exports and `typesVersions`:

```json
"./adsense": {
  "types": "./dist/adsense/index.d.ts",
  "import": "./dist/adsense/index.js"
}
```

```json
"adsense": [
  "dist/adsense/index.d.ts"
]
```

- [ ] **Step 6: Run shared tests and typecheck**

Run: `pnpm --filter @airo/shared test -- src/adsense/__tests__/validation.test.ts`

Expected: PASS.

Run: `pnpm --filter @airo/shared typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/adsense packages/shared/src/index.ts packages/shared/package.json
git commit -m "feat: add adsense settings contract"
```

---

### Task 2: Agents File Service and Settings API

**Files:**
- Create: `agents/src/services/AdSenseSettingsFileService.ts`
- Create: `agents/src/services/__tests__/AdSenseSettingsFileService.test.ts`
- Create: `agents/src/server/routes/adsense.ts`
- Create: `agents/src/server/routes/__tests__/adsense.test.ts`
- Modify: `agents/src/server/routes/index.ts`
- Modify: `agents/src/server/app.ts`
- Modify: `agents/src/tools/ai-lib-tools/__tests__/text-editor.security.test.ts`

- [ ] **Step 1: Write file-service tests**

Cover these required behaviors:
- Missing `.airo/adsense.json` returns disabled settings with `updatedAt: null`.
- Malformed `.airo/adsense.json` returns disabled settings and logs a warning, not a 500.
- Valid `.airo/adsense.json` is parsed and normalized through shared validation.
- Saves create `.airo/` lazily and write canonical JSON to `.airo/adsense.json`.
- Disabled saves clear `publisherId` and canonical script output so stale script delivery cannot survive.

Run: `pnpm --filter @airo/agents test:unit src/services/__tests__/AdSenseSettingsFileService.test.ts`

Expected: FAIL until the file service exists.

- [ ] **Step 2: Implement `AdSenseSettingsFileService`**

Implement the service around `createForWorkspace(appId, 'preview')` and the workspace file API:
- `getSettings(appId)` reads `.airo/adsense.json`.
- `saveSettings(appId, input)` normalizes via `@airo/shared/adsense`, creates `.airo/` if needed, and writes canonical JSON.
- Do not add schema changes or a persistence repository.
- Missing file is normal empty state; permission/transport failures should be surfaced as route errors.

- [ ] **Step 3: Write route tests**

Create `agents/src/server/routes/__tests__/adsense.test.ts` with:
- `GET /apps/:id/adsense` returns file-service settings.
- Missing file response is 200 disabled settings.
- Invalid save input returns 400 field errors.
- Valid save calls the file service and returns canonical settings.
- App ownership middleware remains mounted for `/apps/:id/adsense`.

- [ ] **Step 4: Implement and mount route**

Create `agents/src/server/routes/adsense.ts`:
- Use `validateAppOwnership`.
- Use `AdSenseSettingsFileService`.
- `GET` delegates to `getSettings(id)`.
- `PUT` delegates to `saveSettings(id, req.body)`.
- Do not add the route to PaaS allowed routes unless product scope changes.

Export and mount the route in `agents/src/server/routes/index.ts` and `agents/src/server/app.ts`.

- [ ] **Step 5: Add protected-path coverage**

Extend `agents/src/tools/ai-lib-tools/__tests__/text-editor.security.test.ts`:

```typescript
expect(isProtectedWorkspacePath('/app/.airo/adsense.json', '/app')).toBe(true);
```

- [ ] **Step 6: Run agents tests**

Run:

```bash
pnpm --filter @airo/agents test:unit src/services/__tests__/AdSenseSettingsFileService.test.ts src/server/routes/__tests__/adsense.test.ts src/tools/ai-lib-tools/__tests__/text-editor.security.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add agents/src/services agents/src/server/routes agents/src/server/app.ts agents/src/tools/ai-lib-tools/__tests__/text-editor.security.test.ts
git commit -m "feat: save adsense settings file"
```

---

### Task 3: Publish Runtime Manifest Generation

**Files:**
- Create: `agents/src/services/AdSensePublishManifestService.ts`
- Create: `agents/src/services/__tests__/AdSensePublishManifestService.test.ts`
- Modify: `agents/src/server/routes/publish.ts`
- Modify: `agents/src/server/routes/publish.test.ts`
- Modify: `agents/src/server/routes/publish/strategies/PublishStrategy.ts`
- Modify: `agents/src/server/routes/publish/strategies/DefaultPublishStrategy.ts`
- Modify: `agents/src/server/routes/publish/strategies/__tests__/DefaultPublishStrategy.test.ts`

- [ ] **Step 1: Write manifest service tests**

Create `agents/src/services/__tests__/AdSensePublishManifestService.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { ADSENSE_RUNTIME_MANIFEST_PATH } from '@airo/shared/adsense';

import { AdSensePublishManifestService } from '../AdSensePublishManifestService.js';

describe('AdSensePublishManifestService', () => {
  it('writes the generated runtime manifest into dist for the next publish', async () => {
    const write = vi.fn().mockResolvedValue({ bytesWritten: 10 });
    const settingsFileService = {
      getSettings: vi.fn().mockResolvedValue({
        publisherId: 'ca-pub-1234567890123456',
        scriptSnippet: '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>',
        adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: false, content: 'draft app ads' },
        updatedAt: '2026-06-03T12:00:00.000Z',
      }),
    };

    const service = new AdSensePublishManifestService(settingsFileService as any);
    await service.writeForPublish('test-app-id', { files: { write } } as any);

    expect(settingsFileService.getSettings).toHaveBeenCalledWith('test-app-id');
    expect(write).toHaveBeenCalledWith({
      path: ADSENSE_RUNTIME_MANIFEST_PATH,
      content: JSON.stringify({
        version: 1,
        publisherId: 'ca-pub-1234567890123456',
        scriptSnippet: '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>',
        adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
        appAdsTxt: { enabled: false, content: 'draft app ads' },
      }, null, 2) + '\n',
    });
  });

  it('writes a disabled runtime manifest when no settings exist so old publish output is removed', async () => {
    const write = vi.fn().mockResolvedValue({ bytesWritten: 10 });
    const settingsFileService = {
      getSettings: vi.fn().mockResolvedValue({
        publisherId: null,
        scriptSnippet: '',
        adsTxt: { enabled: false, content: '' },
        appAdsTxt: { enabled: false, content: '' },
        updatedAt: null,
      }),
    };

    const service = new AdSensePublishManifestService(settingsFileService as any);
    await service.writeForPublish('test-app-id', { files: { write } } as any);

    expect(write).toHaveBeenCalledWith(expect.objectContaining({
      path: ADSENSE_RUNTIME_MANIFEST_PATH,
    }));
  });

  it('overwrites the generated runtime manifest with disabled settings on a later publish', async () => {
    const write = vi.fn().mockResolvedValue({ bytesWritten: 10 });
    const settingsFileService = {
      getSettings: vi
        .fn()
        .mockResolvedValueOnce({
          publisherId: 'ca-pub-1234567890123456',
          scriptSnippet: '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>',
          adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
          appAdsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
          updatedAt: '2026-06-03T12:00:00.000Z',
        })
        .mockResolvedValueOnce({
          publisherId: null,
          scriptSnippet: '',
          adsTxt: { enabled: false, content: '' },
          appAdsTxt: { enabled: false, content: '' },
          updatedAt: '2026-06-03T12:00:01.000Z',
        }),
    };

    const service = new AdSensePublishManifestService(settingsFileService as any);
    await service.writeForPublish('test-app-id', { files: { write } } as any);
    await service.writeForPublish('test-app-id', { files: { write } } as any);

    expect(write).toHaveBeenNthCalledWith(2, expect.objectContaining({
      path: ADSENSE_RUNTIME_MANIFEST_PATH,
      content: expect.stringContaining('"publisherId": null'),
    }));
    expect(write.mock.calls[1][0].content).toContain('"scriptSnippet": ""');
    expect(write.mock.calls[1][0].content).toContain('"enabled": false');
  });
});
```

- [ ] **Step 2: Implement manifest service**

Create `agents/src/services/AdSensePublishManifestService.ts`:

```typescript
import type { AdSensePublishManifest } from '@airo/shared/adsense';
import { ADSENSE_RUNTIME_MANIFEST_PATH } from '@airo/shared/adsense';

import { Logger } from '../logging/index.js';
import { AdSenseSettingsFileService } from './AdSenseSettingsFileService.js';
import type { WorkspaceClient } from '../workspace/client.js';

const logger = Logger.create({ component: 'adsense-publish-manifest-service' });

export class AdSensePublishManifestService {
  constructor(private readonly settingsFileService = new AdSenseSettingsFileService()) {}

  async writeForPublish(appId: string, workspace: Pick<WorkspaceClient, 'files'>): Promise<void> {
    const settings = await this.settingsFileService.getSettings(appId);
    const manifest: AdSensePublishManifest = {
      version: 1,
      publisherId: settings.publisherId,
      scriptSnippet: settings.scriptSnippet,
      adsTxt: settings.adsTxt,
      appAdsTxt: settings.appAdsTxt,
    };

    await workspace.files.write({
      path: ADSENSE_RUNTIME_MANIFEST_PATH,
      content: `${JSON.stringify(manifest, null, 2)}\n`,
    });

    logger.info('adsense.publish_manifest.write.success', {
      appId,
      hasPublisherId: Boolean(manifest.publisherId),
      adsTxtEnabled: manifest.adsTxt.enabled,
      appAdsTxtEnabled: manifest.appAdsTxt.enabled,
    });
  }
}
```

- [ ] **Step 3: Add a post-build/pre-archive publish hook**

Modify `agents/src/server/routes/publish/strategies/PublishStrategy.ts`:

```typescript
export interface PublishContext {
  appId: string;
  appPath: string;
  targetDir?: string;
  tasks: WorkspaceTasks;
  gitUtils: GitUtils;
  logger: ILogger;
  beforeArchive?: (context: PublishContext, commitHash: string) => Promise<void>;
}
```

Modify `agents/src/server/routes/publish/strategies/DefaultPublishStrategy.ts` so the hook runs after the production build creates `dist/` and before `gitUtils.createArchive(...)` archives it:

```typescript
// 3. Build
await this.build(context, commitHash);

// 4. Generate runtime artifacts that must be present in dist-only archives
await context.beforeArchive?.(context, commitHash);

// 5. Create archive (auto-detect based on server.bundle.cjs)
const archivePath = await this.createArchive(context, commitHash);
```

Update `agents/src/server/routes/publish/strategies/__tests__/DefaultPublishStrategy.test.ts`:
- Assert the hook runs after the build command and before `gitUtils.createArchive(...)`.
- Assert `gitUtils.createArchive(...)` is not called when the hook rejects.
- Assert the hook receives the same `PublishContext` and commit hash that the archive step uses.

This replaces the older root-file copy approach. Do not add an AdSense-specific copy path to `GitUtils`; the approved runtime artifact is written directly to `dist/airo-adsense.json` before archive creation.

- [ ] **Step 4: Wire publish route hook**

Modify `agents/src/server/routes/publish.ts`:

```typescript
import { AdSensePublishManifestService } from '../../services/AdSensePublishManifestService.js';
```

Add near `const appRepository = new AppRepository();`:

```typescript
const adSensePublishManifestService = new AdSensePublishManifestService();
```

When creating `publishContext`, add:

```typescript
beforeArchive: () => adSensePublishManifestService.writeForPublish(id, workspace),
```

Expected order: app lookup -> workspace lookup -> strategy selection/context -> `strategy.prepareBuild(...)` -> default strategy build -> AdSense runtime manifest write to `dist/airo-adsense.json` -> archive.

- [ ] **Step 5: Update publish route tests**

In `agents/src/server/routes/publish.test.ts`, mock the service:

```typescript
const mockWriteAdSenseManifestForPublish = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/AdSensePublishManifestService.js', () => ({
  AdSensePublishManifestService: vi.fn().mockImplementation(() => ({
    writeForPublish: mockWriteAdSenseManifestForPublish,
  })),
}));
```

Add tests in the successful publish describe:

```typescript
it('passes an adsense runtime-manifest hook into the publish strategy', async () => {
  const prepareBuild = vi.fn().mockImplementation(async (context) => {
    await context.beforeArchive?.(context, 'abc1234567890');
    return {
      commitHash: 'abc1234567890',
      archivePath: '/dist/abc1234567890.tar.gz',
    };
  });
  vi.mocked(getPublishStrategy).mockReturnValue({
    key: 'default',
    prepareBuild,
    deploy: vi.fn(),
  } as any);
  mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app' });
  const workspace = { tasks: { runCommandSync: vi.fn() }, files: { write: vi.fn() } };
  mockCreateForWorkspace.mockReturnValue(workspace);

  const testApp = createPublishApp();
  await request(testApp).post('/apps/test-app-id/publish').send({}).expect(200);

  expect(mockWriteAdSenseManifestForPublish).toHaveBeenCalledWith('test-app-id', workspace);
});

it('returns 500 when adsense runtime-manifest generation fails before archive', async () => {
  mockWriteAdSenseManifestForPublish.mockRejectedValueOnce(new Error('write failed'));
  const prepareBuild = vi.fn().mockImplementation(async (context) => {
    await context.beforeArchive?.(context, 'abc1234567890');
    return {
      commitHash: 'abc1234567890',
      archivePath: '/dist/abc1234567890.tar.gz',
    };
  });
  vi.mocked(getPublishStrategy).mockReturnValue({
    key: 'default',
    prepareBuild,
    deploy: vi.fn(),
  } as any);
  mockFindById.mockReturnValue({ id: 'test-app-id', path: '/tmp/test-app' });
  mockCreateForWorkspace.mockReturnValue({ tasks: { runCommandSync: vi.fn() }, files: { write: vi.fn() } });

  const testApp = createPublishApp();
  const response = await request(testApp).post('/apps/test-app-id/publish').send({}).expect(500);

  expect(response.body.error).toBe('Failed to publish archive');
});
```

- [ ] **Step 6: Prove archive visibility**

The archive proof must cover these assertions:
- `AdSensePublishManifestService` writes exactly `dist/airo-adsense.json`.
- `DefaultPublishStrategy` invokes the manifest hook after build success and before `gitUtils.createArchive(...)`.
- A failing manifest hook prevents archive creation.
- The archive path remains the standard dist-only archive path; no public `dist/client/airo-adsense.json` copy is created.

If adding an archive-content smoke test is practical in `agents/src/utils/__tests__/`, create a temporary dist tree with `dist/airo-adsense.json`, run the same tar command path, and assert `tar -tzf` lists `dist/airo-adsense.json`. If the existing command-runner abstraction makes that too brittle, keep the explicit hook-order assertion as the required archive proof because `GitUtils` archives the whole `dist` directory once the file exists there.

- [ ] **Step 7: Run targeted agents tests**

Run:

```bash
pnpm --filter @airo/agents test:unit src/services/__tests__/AdSensePublishManifestService.test.ts src/server/routes/publish.test.ts src/server/routes/publish/strategies/__tests__/DefaultPublishStrategy.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add agents/src/services/AdSensePublishManifestService.ts agents/src/services/__tests__/AdSensePublishManifestService.test.ts agents/src/server/routes/publish.ts agents/src/server/routes/publish.test.ts agents/src/server/routes/publish/strategies
git commit -m "feat: publish adsense runtime manifest"
```

---

### Publish Delivery Gate: Complete Before Builder UI

This gate exists because AIROBUILD-1711 identifies publish/runtime delivery as the main risk. Complete it after Task 3 and Task 5, before starting the builder UI task.

**Files:**
- Test: `agents/src/services/__tests__/AdSensePublishManifestService.test.ts`
- Test: `agents/src/server/routes/publish/strategies/__tests__/DefaultPublishStrategy.test.ts`
- Test: `app-templates/v8/src/server/adsense-manifest.test.ts`
- Test: `app-templates/v8/src/server/entry.test.ts`

- [ ] **Step 1: Prove the authoring fixture writes the runtime manifest**

Run:

```bash
pnpm --filter @airo/agents test:unit src/services/__tests__/AdSensePublishManifestService.test.ts
```

Expected: PASS. The test output must cover enabled `.airo/adsense.json` settings, generation at exactly `dist/airo-adsense.json`, and a later disabled publish that overwrites the runtime manifest with disabled delivery.

- [ ] **Step 2: Prove archive creation happens after runtime manifest generation**

Run the default publish strategy test:

```bash
pnpm --filter @airo/agents test:unit src/server/routes/publish/strategies/__tests__/DefaultPublishStrategy.test.ts -t "beforeArchive"
```

Expected: PASS. The assertions must prove the `beforeArchive` hook runs after build success and before `gitUtils.createArchive(...)`, and that a hook failure prevents archive creation. Combined with Step 1, this proves the dist-only archive sees `dist/airo-adsense.json`.

- [ ] **Step 3: Prove the published runtime reads from the dist server directory**

Run:

```bash
npm --prefix app-templates/v8 test -- src/server/adsense-manifest.test.ts
```

Expected: PASS. The tests must create `airo-adsense.json` in the same directory passed to `loadAdSenseManifest(...)`, proving the runtime reads from the bundled server directory that contains generated `dist/airo-adsense.json` after archive extraction.

- [ ] **Step 4: Prove SSR head injection uses the published template path**

Run:

```bash
npm --prefix app-templates/v8 test -- src/server/entry.test.ts
```

Expected: PASS. The test must call the exported SSR template helper and prove the AdSense script appears in the replaced `<!--app-head-->` marker with the SSR route head content.

- [ ] **Step 5: Proceed to UI only after delivery is green**

Do not start `DisplayAdsPanel` implementation until all four gate steps pass. If any step fails, fix publish/runtime delivery before adding UI controls.

---

### Task 4: Builder Display Ads Settings UI

**Files:**
- Create: `app/src/hooks/useAdSenseSettings.ts`
- Create: `app/src/app/[market]/develop/components/settings/DisplayAds/useAdSenseSettingsForm.ts`
- Create: `app/src/app/[market]/develop/components/settings/DisplayAds/DisplayAdsPanel.tsx`
- Create: `app/src/app/[market]/develop/components/settings/DisplayAds/DisplayAdsPanel.test.tsx`
- Modify: `app/src/app/[market]/develop/components/types.ts`
- Modify: `app/src/app/[market]/develop/components/settings/useSettingsNavItems.tsx`
- Modify: `app/src/app/[market]/develop/components/settings/useSettingsNavItems.test.tsx`
- Modify: `app/src/app/[market]/develop/components/settings/SettingsMenu.test.tsx`
- Modify: `app/src/app/[market]/develop/components/settings/SettingsView.tsx`

- [ ] **Step 1: Add hooks tests**

Create hook coverage inside `app/src/hooks/useAdSenseSettings.test.tsx` or cover through the panel test if local convention prefers component-level API mocking.

Required behavior:

```typescript
expect(queryKey).toEqual(['adsense-settings', appId]);
expect(agentFetch).toHaveBeenCalledWith(
  expect.stringContaining(`/apps/${appId}/adsense`),
  expect.objectContaining({ siteId: appId, method: 'GET' }),
);
expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['adsense-settings', appId] });
```

- [ ] **Step 2: Implement hooks**

Create `app/src/hooks/useAdSenseSettings.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdSenseSettings, AdSenseSettingsInput } from '@airo/shared/adsense';

import { buildDynamicApiUrl } from '@/config/dynamic-api';
import { agentFetch } from '@/lib/agent-fetch';

interface AdSenseSettingsResponse {
  settings: AdSenseSettings;
}

export function adSenseSettingsQueryKey(appId: string) {
  return ['adsense-settings', appId] as const;
}

export function useAdSenseSettings(appId: string, enabled = true) {
  return useQuery({
    queryKey: adSenseSettingsQueryKey(appId),
    queryFn: async (): Promise<AdSenseSettings> => {
      const apiUrl = await buildDynamicApiUrl('adsense', appId);
      const response = await agentFetch(apiUrl, { siteId: appId, method: 'GET' });
      if (!response.ok) throw new Error(`Failed to load AdSense settings: ${response.status}`);
      const data = (await response.json()) as AdSenseSettingsResponse;
      return data.settings;
    },
    enabled: enabled && !!appId,
    staleTime: 30_000,
  });
}

export function useUpdateAdSenseSettings(appId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: AdSenseSettingsInput): Promise<AdSenseSettings> => {
      const apiUrl = await buildDynamicApiUrl('adsense', appId);
      const response = await agentFetch(apiUrl, {
        siteId: appId,
        method: 'PUT',
        body: JSON.stringify(settings),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = data.error ?? `Failed to save AdSense settings: ${response.status}`;
        const error = new Error(message);
        (error as Error & { fieldErrors?: unknown }).fieldErrors = data.errors;
        throw error;
      }

      return (data as AdSenseSettingsResponse).settings;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adSenseSettingsQueryKey(appId) });
    },
  });
}
```

- [ ] **Step 3: Implement local form hook**

Create `app/src/app/[market]/develop/components/settings/DisplayAds/useAdSenseSettingsForm.ts`:

```typescript
import { useEffect, useMemo, useState } from 'react';
import type { AdSenseSettings, AdSenseSettingsInput, AdSenseValidationErrors } from '@airo/shared/adsense';
import { normalizeAdSenseSettingsInput } from '@airo/shared/adsense';

export interface AdSenseSettingsFormState {
  scriptSnippet: string;
  adsTxtEnabled: boolean;
  adsTxtContent: string;
  appAdsTxtEnabled: boolean;
  appAdsTxtContent: string;
}

const blankState: AdSenseSettingsFormState = {
  scriptSnippet: '',
  adsTxtEnabled: false,
  adsTxtContent: '',
  appAdsTxtEnabled: false,
  appAdsTxtContent: '',
};

function fromSettings(settings: AdSenseSettings | undefined): AdSenseSettingsFormState {
  if (!settings) return blankState;
  return {
    scriptSnippet: settings.scriptSnippet,
    adsTxtEnabled: settings.adsTxt.enabled,
    adsTxtContent: settings.adsTxt.content,
    appAdsTxtEnabled: settings.appAdsTxt.enabled,
    appAdsTxtContent: settings.appAdsTxt.content,
  };
}

export function toAdSenseSettingsInput(state: AdSenseSettingsFormState): AdSenseSettingsInput {
  return {
    scriptSnippet: state.scriptSnippet,
    adsTxt: { enabled: state.adsTxtEnabled, content: state.adsTxtContent },
    appAdsTxt: { enabled: state.appAdsTxtEnabled, content: state.appAdsTxtContent },
  };
}

export function useAdSenseSettingsForm(settings: AdSenseSettings | undefined) {
  const [state, setState] = useState<AdSenseSettingsFormState>(() => fromSettings(settings));
  const [baseline, setBaseline] = useState<AdSenseSettingsFormState>(() => fromSettings(settings));
  const [serverErrors, setServerErrors] = useState<AdSenseValidationErrors>({});

  useEffect(() => {
    const next = fromSettings(settings);
    setState(next);
    setBaseline(next);
    setServerErrors({});
  }, [settings]);

  const clientValidation = useMemo(() => {
    const result = normalizeAdSenseSettingsInput(toAdSenseSettingsInput(state));
    return result.ok ? {} : result.errors;
  }, [state]);

  const errors = { ...clientValidation, ...serverErrors };
  const hasErrors = Object.keys(errors).length > 0;
  const isDirty = JSON.stringify(state) !== JSON.stringify(baseline);

  return {
    state,
    setState,
    errors,
    hasErrors,
    isDirty,
    input: toAdSenseSettingsInput(state),
    setServerErrors,
    reset: () => {
      setState(baseline);
      setServerErrors({});
    },
    markSaved: (saved: AdSenseSettings) => {
      const next = fromSettings(saved);
      setState(next);
      setBaseline(next);
      setServerErrors({});
    },
  };
}
```

- [ ] **Step 4: Write panel tests**

Create `app/src/app/[market]/develop/components/settings/DisplayAds/DisplayAdsPanel.test.tsx` with mocked hooks:

```typescript
/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { renderWithProviders } from '@/tests/test-utils';
import DisplayAdsPanel from './DisplayAdsPanel';

const mockUpdate = vi.fn();
const mockRefetch = vi.fn();
const mockUseAdSenseSettings = vi.fn();

vi.mock('@/hooks/useAdSenseSettings', () => ({
  useAdSenseSettings: (...args: unknown[]) => mockUseAdSenseSettings(...args),
  useUpdateAdSenseSettings: () => ({ mutateAsync: mockUpdate, isPending: false }),
}));

describe('DisplayAdsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({
      publisherId: 'ca-pub-1234567890123456',
      scriptSnippet: '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>',
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: false, content: '' },
      updatedAt: '2026-06-03T12:00:00.000Z',
    });
    mockUseAdSenseSettings.mockReturnValue({
      data: {
        publisherId: null,
        scriptSnippet: '',
        adsTxt: { enabled: false, content: '' },
        appAdsTxt: { enabled: false, content: '' },
        updatedAt: null,
      },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });
  });

  it('renders the Google AdSense settings form', () => {
    renderWithProviders(<DisplayAdsPanel appId="test-app-id" />);
    expect(screen.getByText('builder_settings_display_ads_title')).toBeInTheDocument();
    expect(screen.getByLabelText('builder_settings_display_ads_script_label')).toBeInTheDocument();
    expect(screen.getByLabelText('builder_settings_display_ads_ads_txt_toggle')).toBeInTheDocument();
    expect(screen.getByLabelText('builder_settings_display_ads_app_ads_txt_toggle')).toBeInTheDocument();
  });

  it('blocks save when enabled ads.txt content is empty', async () => {
    const { user } = renderWithProviders(<DisplayAdsPanel appId="test-app-id" />);
    await user.click(screen.getByLabelText('builder_settings_display_ads_ads_txt_toggle'));
    expect(screen.getByText('ads.txt content is required when enabled.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'builder_common_save' })).toBeDisabled();
  });

  it('saves normalized settings', async () => {
    const { user } = renderWithProviders(<DisplayAdsPanel appId="test-app-id" />);
    await user.type(screen.getByLabelText('builder_settings_display_ads_script_label'), '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>');
    await user.click(screen.getByLabelText('builder_settings_display_ads_ads_txt_toggle'));
    await user.type(screen.getByLabelText('builder_settings_display_ads_ads_txt_label'), 'google.com, pub-123, DIRECT, f08c47fec0942fa0');
    await user.click(screen.getByRole('button', { name: 'builder_common_save' }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
        scriptSnippet: expect.stringContaining('ca-pub-1234567890123456'),
        adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      }));
    });
  });

  it('shows retry when loading fails', async () => {
    mockUseAdSenseSettings.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('load failed'),
      refetch: mockRefetch,
    });
    const { user } = renderWithProviders(<DisplayAdsPanel appId="test-app-id" />);
    await user.click(screen.getByRole('button', { name: 'builder_common_retry' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('refreshes text-file fields when query data changes without an updatedAt change', () => {
    const firstSettings = {
      publisherId: null,
      scriptSnippet: '',
      adsTxt: { enabled: true, content: 'first ads.txt value' },
      appAdsTxt: { enabled: false, content: '' },
      updatedAt: '2026-06-03T12:00:00.000Z',
    };
    const secondSettings = {
      ...firstSettings,
      adsTxt: { enabled: true, content: 'second ads.txt value' },
    };

    mockUseAdSenseSettings.mockReturnValue({
      data: firstSettings,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    const { rerender } = renderWithProviders(<DisplayAdsPanel appId="test-app-id" />);
    expect(screen.getByLabelText('builder_settings_display_ads_ads_txt_label')).toHaveValue('first ads.txt value');

    mockUseAdSenseSettings.mockReturnValue({
      data: secondSettings,
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    });

    rerender(<DisplayAdsPanel appId="test-app-id" />);
    expect(screen.getByLabelText('builder_settings_display_ads_ads_txt_label')).toHaveValue('second ads.txt value');
  });
});
```

- [ ] **Step 5: Implement panel**

Create `app/src/app/[market]/develop/components/settings/DisplayAds/DisplayAdsPanel.tsx`:

```typescript
'use client';

import Alert from '@ux/alert';
import Box from '@ux/box';
import Button from '@ux/button';
import Checkbox from '@ux/checkbox';
import Growl from '@ux/growl';
import Spinner from '@ux/spinner';
import TextInput from '@ux/text-input';

import { SettingsLoadingState } from '@/app/[market]/develop/components/settings/components/SettingsLoadingState';
import SettingsSection from '@/app/[market]/develop/components/settings/SettingsSection';
import EmptyStateCard from '@/components/layout/EmptyStateCard';
import { useAdSenseSettings, useUpdateAdSenseSettings } from '@/hooks/useAdSenseSettings';
import { useTranslations } from '@/hooks/useTranslations';
import { logger } from '@/lib/request-context';
import { useAdSenseSettingsForm } from './useAdSenseSettingsForm';

interface DisplayAdsPanelProps {
  appId: string;
}

function fieldErrors(error: unknown) {
  return (error as Error & { fieldErrors?: Record<string, string> }).fieldErrors ?? {};
}

export default function DisplayAdsPanel({ appId }: DisplayAdsPanelProps) {
  const t = useTranslations();
  const { data, isLoading, error, refetch } = useAdSenseSettings(appId);
  const updateSettings = useUpdateAdSenseSettings(appId);
  const form = useAdSenseSettingsForm(data);

  async function handleSave(): Promise<void> {
    try {
      const saved = await updateSettings.mutateAsync(form.input);
      form.markSaved(saved);
      Growl.addGrowlMessage({
        title: t('builder_settings_display_ads_save_success', undefined, 'Display ads settings saved'),
        emphasis: 'success',
        lifetime: 3000,
      });
    } catch (saveError) {
      form.setServerErrors(fieldErrors(saveError));
      logger.error('display-ads-settings.save.error', {
        appId,
        error: saveError instanceof Error ? saveError.message : String(saveError),
      });
      Growl.addGrowlMessage({
        title: t('builder_settings_display_ads_save_error', undefined, 'Unable to save display ads settings'),
        emphasis: 'critical',
        lifetime: 5000,
      });
    }
  }

  if (isLoading) return <SettingsLoadingState fullPage />;

  if (error) {
    return (
      <EmptyStateCard
        title={t('builder_settings_display_ads_error_title', undefined, 'Unable to load display ads settings')}
        description={error instanceof Error ? error.message : t('builder_common_error', undefined, 'Something went wrong')}
        ctaLabel={t('builder_common_retry')}
        onCtaClick={() => void refetch()}
      />
    );
  }

  return (
    <>
      <Box gap="lg" className="@container">
        <SettingsSection
          title={t('builder_settings_display_ads_title', undefined, 'Google AdSense')}
          description={t('builder_settings_display_ads_description', undefined, 'Paste your Google AdSense script and verification file contents. Changes apply on your next publish.')}
          button={
            <div className="flex gap-1.5 justify-end">
              <Button
                design="secondary"
                size="sm"
                text={t('builder_common_reset', undefined, 'Reset')}
                disabled={!form.isDirty || updateSettings.isPending}
                onClick={form.reset}
              />
              <Button
                design="primary"
                size="sm"
                text={updateSettings.isPending ? t('builder_common_saving', undefined, 'Saving...') : t('builder_common_save')}
                icon={updateSettings.isPending ? <Spinner size="sm" /> : undefined}
                disabled={!form.isDirty || form.hasErrors || updateSettings.isPending}
                onClick={() => void handleSave()}
              />
            </div>
          }
          hideStatus
        >
          <Alert emphasis="info">
            {t('builder_settings_display_ads_publish_note', undefined, 'Saved changes are included the next time you publish this app.')}
          </Alert>
          <TextInput
            id="displayAdsScriptSnippet"
            label={t('builder_settings_display_ads_script_label', undefined, 'AdSense script snippet')}
            multiline
            size={4}
            value={form.state.scriptSnippet}
            onChange={(scriptSnippet: string) => form.setState((current) => ({ ...current, scriptSnippet }))}
            errorMessage={form.errors.scriptSnippet}
            placeholder='<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>'
          />
        </SettingsSection>

        <SettingsSection
          title={t('builder_settings_display_ads_ads_txt_title', undefined, 'ads.txt')}
          description={t('builder_settings_display_ads_ads_txt_description', undefined, 'Serve the content Google asks you to host at /ads.txt.')}
          hideStatus
        >
          <Checkbox
            id="displayAdsAdsTxtEnabled"
            name="displayAdsAdsTxtEnabled"
            checked={form.state.adsTxtEnabled}
            onChange={(checked: boolean) => form.setState((current) => ({ ...current, adsTxtEnabled: checked }))}
            label={t('builder_settings_display_ads_ads_txt_toggle', undefined, 'Enable ads.txt')}
          />
          <TextInput
            id="displayAdsAdsTxtContent"
            label={t('builder_settings_display_ads_ads_txt_label', undefined, 'ads.txt content')}
            multiline
            size={6}
            value={form.state.adsTxtContent}
            disabled={!form.state.adsTxtEnabled}
            onChange={(adsTxtContent: string) => form.setState((current) => ({ ...current, adsTxtContent }))}
            errorMessage={form.errors.adsTxt}
          />
        </SettingsSection>

        <SettingsSection
          title={t('builder_settings_display_ads_app_ads_txt_title', undefined, 'app-ads.txt')}
          description={t('builder_settings_display_ads_app_ads_txt_description', undefined, 'Serve app ads verification content at /app-ads.txt when needed.')}
          hideStatus
        >
          <Checkbox
            id="displayAdsAppAdsTxtEnabled"
            name="displayAdsAppAdsTxtEnabled"
            checked={form.state.appAdsTxtEnabled}
            onChange={(checked: boolean) => form.setState((current) => ({ ...current, appAdsTxtEnabled: checked }))}
            label={t('builder_settings_display_ads_app_ads_txt_toggle', undefined, 'Enable app-ads.txt')}
          />
          <TextInput
            id="displayAdsAppAdsTxtContent"
            label={t('builder_settings_display_ads_app_ads_txt_label', undefined, 'app-ads.txt content')}
            multiline
            size={6}
            value={form.state.appAdsTxtContent}
            disabled={!form.state.appAdsTxtEnabled}
            onChange={(appAdsTxtContent: string) => form.setState((current) => ({ ...current, appAdsTxtContent }))}
            errorMessage={form.errors.appAdsTxt}
          />
        </SettingsSection>
      </Box>
      <Growl />
    </>
  );
}
```

- [ ] **Step 6: Register settings section**

Modify `app/src/app/[market]/develop/components/types.ts`:

```typescript
DISPLAY_ADS = 'displayAds',
```

Modify `app/src/app/[market]/develop/components/settings/useSettingsNavItems.tsx`:

```typescript
const displayAds = useSwitchboard('appbuilder-settings-display-ads');
```

Add the nav item before feedback:

```typescript
...(displayAds ? [{
  id: SettingsSection.DISPLAY_ADS,
  label: t('builder_settings_nav_display_ads', undefined, 'Display Ads'),
  icon: <ContentIcon />,
  disabled: false,
}] : []),
```

Modify `SettingsView.tsx`:

```typescript
const DisplayAdsPanel = dynamic(() => import('@/app/[market]/develop/components/settings/DisplayAds/DisplayAdsPanel'), { loading: () => <PanelSkeleton /> });
const isDisplayAdsEnabled = useSwitchboard('appbuilder-settings-display-ads');
```

Add render case:

```typescript
case SettingsSection.DISPLAY_ADS:
  if (isDisplayAdsEnabled === undefined) return sectionSkeleton;
  return isDisplayAdsEnabled ? <DisplayAdsPanel appId={appId} /> : null;
```

- [ ] **Step 7: Update nav/menu tests**

In `useSettingsNavItems.test.tsx` and `SettingsMenu.test.tsx`, add default mock behavior:

```typescript
if (feature === 'appbuilder-settings-display-ads') return true;
```

Add expectations:

```typescript
const displayAdsItem = result.current.find(item => item.id === SettingsSection.DISPLAY_ADS);
expect(displayAdsItem).toBeDefined();
expect(displayAdsItem?.label).toBe('builder_settings_nav_display_ads');
expect(displayAdsItem?.disabled).toBe(false);
```

In `SettingsMenu.test.tsx`, click the item:

```typescript
await user.click(screen.getByText('builder_settings_nav_display_ads'));
expect(setActiveSettingsSection).toHaveBeenCalledWith(SettingsSection.DISPLAY_ADS);
expect(vi.mocked(logClickEvent)).toHaveBeenCalledWith(
  'develop.settings_menu.displayAds',
  { appId: 'test-app-id' },
);
```

- [ ] **Step 8: i18n keys**

Create the following keys in the `@airo-app-builder/aab` i18n package before final pre-commit validation:

```text
builder_settings_nav_display_ads=Display Ads
builder_settings_display_ads_title=Google AdSense
builder_settings_display_ads_description=Paste your Google AdSense script and verification file contents. Changes apply on your next publish.
builder_settings_display_ads_script_label=AdSense script snippet
builder_settings_display_ads_publish_note=Saved changes are included the next time you publish this app.
builder_settings_display_ads_ads_txt_title=ads.txt
builder_settings_display_ads_ads_txt_description=Serve the content Google asks you to host at /ads.txt.
builder_settings_display_ads_ads_txt_toggle=Enable ads.txt
builder_settings_display_ads_ads_txt_label=ads.txt content
builder_settings_display_ads_app_ads_txt_title=app-ads.txt
builder_settings_display_ads_app_ads_txt_description=Serve app ads verification content at /app-ads.txt when needed.
builder_settings_display_ads_app_ads_txt_toggle=Enable app-ads.txt
builder_settings_display_ads_app_ads_txt_label=app-ads.txt content
builder_settings_display_ads_save_success=Display ads settings saved
builder_settings_display_ads_save_error=Unable to save display ads settings
builder_settings_display_ads_error_title=Unable to load display ads settings
```

- [ ] **Step 9: Run app tests**

Run: `pnpm --filter website test -- 'app/src/app/[market]/develop/components/settings/DisplayAds/DisplayAdsPanel.test.tsx' 'app/src/app/[market]/develop/components/settings/useSettingsNavItems.test.tsx' 'app/src/app/[market]/develop/components/settings/SettingsMenu.test.tsx'`

Expected: PASS.

Run: `pnpm --filter website typecheck`

Expected: PASS.

- [ ] **Step 10: Check E2E selector impact**

Run: `rg -n "chat-toolbar-settings-button|settings-feedback-item|builder_settings_nav" tests/e2e tests/regression`

Expected: Existing tests still target the settings trigger and feedback item only. If test order assumptions fail after adding Display Ads, update `tests/regression/develop-chat.spec.ts` and `tests/e2e/e2e.spec.ts` to select by label/test ID rather than positional item order.

- [ ] **Step 11: Commit**

```bash
git add app/src/hooks/useAdSenseSettings.ts app/src/app/[market]/develop/components/types.ts app/src/app/[market]/develop/components/settings
git commit -m "feat: add display ads settings"
```

---

### Task 5: v8 Published Runtime Delivery

**Files:**
- Create: `app-templates/v8/src/server/adsense-manifest.ts`
- Create: `app-templates/v8/src/server/adsense-manifest.test.ts`
- Modify: `app-templates/v8/src/server/entry.ts`
- Create: `app-templates/v8/src/server/entry.test.ts`
- Modify: `container-scripts/preview/sync-template-files.js`
- Modify: `packages/shared/src/app-structure/index.ts`

- [ ] **Step 1: Write runtime helper tests**

Create `app-templates/v8/src/server/adsense-manifest.test.ts`:

```typescript
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildAdSenseHeadHtml,
  loadAdSenseManifest,
  resolveAdSenseTextResponse,
} from './adsense-manifest';

let tempDir: string | null = null;

function makeDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'adsense-manifest-'));
  return tempDir;
}

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('adsense manifest runtime helpers', () => {
  it('returns an empty manifest when the file is absent', () => {
    expect(loadAdSenseManifest(makeDir())).toEqual({
      version: 1,
      publisherId: null,
      scriptSnippet: '',
      adsTxt: { enabled: false, content: '' },
      appAdsTxt: { enabled: false, content: '' },
    });
  });

  it('loads valid manifest content', () => {
    const dir = makeDir();
    writeFileSync(join(dir, 'airo-adsense.json'), JSON.stringify({
      version: 1,
      publisherId: 'ca-pub-1234567890123456',
      scriptSnippet: '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>',
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: false, content: '' },
    }));

    expect(loadAdSenseManifest(dir).publisherId).toBe('ca-pub-1234567890123456');
  });

  it('builds head html from publisher id only', () => {
    expect(buildAdSenseHeadHtml({
      version: 1,
      publisherId: 'ca-pub-1234567890123456',
      scriptSnippet: '',
      adsTxt: { enabled: false, content: '' },
      appAdsTxt: { enabled: false, content: '' },
    })).toContain('client=ca-pub-1234567890123456');
  });

  it('omits disabled or empty text files', () => {
    const manifest = {
      version: 1 as const,
      publisherId: null,
      scriptSnippet: '',
      adsTxt: { enabled: false, content: 'draft' },
      appAdsTxt: { enabled: true, content: '' },
    };
    expect(resolveAdSenseTextResponse(manifest, 'adsTxt')).toBeNull();
    expect(resolveAdSenseTextResponse(manifest, 'appAdsTxt')).toBeNull();
  });

  it('returns enabled text file content', () => {
    const manifest = {
      version: 1 as const,
      publisherId: null,
      scriptSnippet: '',
      adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
      appAdsTxt: { enabled: false, content: '' },
    };
    expect(resolveAdSenseTextResponse(manifest, 'adsTxt')).toBe('google.com, pub-123, DIRECT, f08c47fec0942fa0');
  });
});
```

- [ ] **Step 2: Implement runtime helper**

Create `app-templates/v8/src/server/adsense-manifest.ts`:

```typescript
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Express } from 'express';

export interface AdSenseTextFileSettings {
  enabled: boolean;
  content: string;
}

export interface AdSensePublishManifest {
  version: 1;
  publisherId: string | null;
  scriptSnippet: string;
  adsTxt: AdSenseTextFileSettings;
  appAdsTxt: AdSenseTextFileSettings;
}

const FILENAME = 'airo-adsense.json';
const PUBLISHER_ID_PATTERN = /^ca-pub-\d{16}$/;

export const EMPTY_ADSENSE_MANIFEST: AdSensePublishManifest = {
  version: 1,
  publisherId: null,
  scriptSnippet: '',
  adsTxt: { enabled: false, content: '' },
  appAdsTxt: { enabled: false, content: '' },
};

function isTextFileSettings(value: unknown): value is AdSenseTextFileSettings {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AdSenseTextFileSettings).enabled === 'boolean' &&
    typeof (value as AdSenseTextFileSettings).content === 'string'
  );
}

function isManifest(value: unknown): value is AdSensePublishManifest {
  const candidate = value as AdSensePublishManifest;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.version === 1 &&
    (candidate.publisherId === null || PUBLISHER_ID_PATTERN.test(candidate.publisherId)) &&
    typeof candidate.scriptSnippet === 'string' &&
    isTextFileSettings(candidate.adsTxt) &&
    isTextFileSettings(candidate.appAdsTxt)
  );
}

export function loadAdSenseManifest(baseDir: string): AdSensePublishManifest {
  const manifestPath = join(baseDir, FILENAME);
  if (!existsSync(manifestPath)) return EMPTY_ADSENSE_MANIFEST;

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
    return isManifest(parsed) ? parsed : EMPTY_ADSENSE_MANIFEST;
  } catch (error) {
    console.error('adsense.manifest.load_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_ADSENSE_MANIFEST;
  }
}

export function buildAdSenseHeadHtml(manifest: AdSensePublishManifest): string {
  if (!manifest.publisherId || !PUBLISHER_ID_PATTERN.test(manifest.publisherId)) return '';
  return `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${manifest.publisherId}" crossorigin="anonymous"></script>`;
}

export function resolveAdSenseTextResponse(
  manifest: AdSensePublishManifest,
  key: 'adsTxt' | 'appAdsTxt',
): string | null {
  const file = manifest[key];
  if (!file.enabled || file.content.trim().length === 0) return null;
  return file.content;
}

export function registerAdSenseRoutes(app: Express, manifest: AdSensePublishManifest): void {
  app.get('/ads.txt', (_req, res) => {
    const content = resolveAdSenseTextResponse(manifest, 'adsTxt');
    if (content === null) {
      res.status(404).type('text/plain').send('Not found\n');
      return;
    }
    res.type('text/plain').set('Cache-Control', 'no-cache').send(content);
  });

  app.get('/app-ads.txt', (_req, res) => {
    const content = resolveAdSenseTextResponse(manifest, 'appAdsTxt');
    if (content === null) {
      res.status(404).type('text/plain').send('Not found\n');
      return;
    }
    res.type('text/plain').set('Cache-Control', 'no-cache').send(content);
  });
}
```

- [ ] **Step 3: Wire Express runtime**

Modify `app-templates/v8/src/server/entry.ts`:

```typescript
import {
  buildAdSenseHeadHtml,
  loadAdSenseManifest,
  registerAdSenseRoutes,
} from './adsense-manifest';
```

Inside the `if (import.meta.env.PROD)` block after `const __dirname = dirname(fileURLToPath(import.meta.url));`:

```typescript
const adSenseManifest = loadAdSenseManifest(__dirname);
const adSenseHeadHtml = buildAdSenseHeadHtml(adSenseManifest);
```

Register text routes before `express.static(...)`:

```typescript
registerAdSenseRoutes(app, adSenseManifest);
```

Move the render-result type outside the `if (import.meta.env.PROD)` block and add a small exported helper so the template replacement path can be unit-tested without starting the server:

```typescript
export interface SsrRenderResult {
  html: string;
  head: string;
  status: number;
  redirect?: string;
}

export function renderSsrDocument(
  template: string,
  result: Pick<SsrRenderResult, 'head' | 'html'>,
  extraHeadHtml = '',
): string {
  const head = [result.head, extraHeadHtml].filter(Boolean).join('\n');
  return template
    .replace('<!--app-head-->', () => head)
    .replace('<!--app-html-->', () => result.html);
}
```

When replacing SSR head:

```typescript
const out = renderSsrDocument(template, result, adSenseHeadHtml);
```

- [ ] **Step 4: Add entry-level SSR head injection test**

Create `app-templates/v8/src/server/entry.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { renderSsrDocument } from './entry';

const adsenseScript = '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>';

describe('entry SSR template rendering', () => {
  it('appends the AdSense script to the published head marker', () => {
    const html = renderSsrDocument(
      '<html><head><!--app-head--></head><body><!--app-html--></body></html>',
      {
        head: '<title>Generated Site</title>',
        html: '<main>Rendered app</main>',
      },
      adsenseScript,
    );

    expect(html).toContain(`<title>Generated Site</title>\n${adsenseScript}`);
    expect(html).toContain('<main>Rendered app</main>');
    expect(html).not.toContain('<!--app-head-->');
    expect(html).not.toContain('<!--app-html-->');
  });

  it('omits AdSense head output when the manifest has no publisher id', () => {
    const html = renderSsrDocument(
      '<html><head><!--app-head--></head><body><!--app-html--></body></html>',
      {
        head: '<title>Generated Site</title>',
        html: '<main>Rendered app</main>',
      },
      '',
    );

    expect(html).toContain('<title>Generated Site</title>');
    expect(html).not.toContain('pagead2.googlesyndication.com');
  });
});
```

This is intentionally an `entry.ts` test, not another manifest-helper test. It proves the published SSR template replacement path appends AdSense into the actual `<!--app-head-->` marker used by generated v8 apps.

- [ ] **Step 5: Add Express route tests**

Extend `app-templates/v8/src/server/adsense-manifest.test.ts` with route coverage using Express and Node's built-in `fetch`. Do not add Supertest to v8 for this feature.

Add this test block:

```typescript
import express from 'express';
import type { Server } from 'node:http';
import { registerAdSenseRoutes } from './adsense-manifest';

async function withServer<T>(app: express.Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  let server: Server | null = null;
  try {
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      });
    }
  }
}

it('serves enabled ads.txt and 404s disabled app-ads.txt', async () => {
  const app = express();
  registerAdSenseRoutes(app, {
    version: 1,
    publisherId: null,
    scriptSnippet: '',
    adsTxt: { enabled: true, content: 'google.com, pub-123, DIRECT, f08c47fec0942fa0' },
    appAdsTxt: { enabled: false, content: 'draft' },
  });

  await withServer(app, async (baseUrl) => {
    const adsTxt = await fetch(`${baseUrl}/ads.txt`);
    expect(adsTxt.status).toBe(200);
    expect(await adsTxt.text()).toBe('google.com, pub-123, DIRECT, f08c47fec0942fa0');

    const appAdsTxt = await fetch(`${baseUrl}/app-ads.txt`);
    expect(appAdsTxt.status).toBe(404);
  });
});
```

- [ ] **Step 6: Update template sync**

Modify `container-scripts/preview/sync-template-files.js`.

Add the current hash for `src/server/entry.ts` before this change:

```typescript
'2791732d0b10bf8716d0cc70f3734497', // before AdSense runtime routes/head injection
```

Add a new manifest entry for the helper:

```typescript
{
  file: 'src/server/adsense-manifest.ts',
  description: 'Published runtime helper for AdSense manifest loading, head injection, and ads.txt responses',
  known_hashes: [],
  force: false,
},
```

Because this helper is new, missing customer files sync automatically. Keep it outside `ssrMigration`; it is a small server helper and should not block the broader SSR group.

- [ ] **Step 7: Preserve authoring settings in app import/export structure**

Modify `packages/shared/src/app-structure/index.ts`:

```typescript
'.airo/adsense.json',
```

Place it in `APP_CONFIG_FILES`, not `APP_DIRECTORIES`, so import/export preserves only the AdSense authoring file and does not allow every `.airo/` metadata file.

- [ ] **Step 8: Run v8 and sync tests**

Run: `npm --prefix app-templates/v8 test -- src/server/adsense-manifest.test.ts src/server/entry.test.ts`

Expected: PASS.

Run sync-template tests if present:

```bash
pnpm --filter @airo/agents test:unit src/utils/__tests__/sync-migrations.test.ts src/utils/__tests__/sync-migrations.integration.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add app-templates/v8/src/server container-scripts/preview/sync-template-files.js packages/shared/src/app-structure/index.ts
git commit -m "feat: deliver adsense in published apps"
```

---

### Task 6: End-to-End Verification and Cleanup

**Files:**
- Modify only if verification reveals broken selectors or missing i18n keys.

- [ ] **Step 1: Run targeted package tests**

```bash
pnpm --filter @airo/shared test -- src/adsense/__tests__/validation.test.ts
pnpm --filter @airo/agents test:unit src/services/__tests__/AdSenseSettingsFileService.test.ts src/server/routes/__tests__/adsense.test.ts src/services/__tests__/AdSensePublishManifestService.test.ts src/server/routes/publish.test.ts src/server/routes/publish/strategies/__tests__/DefaultPublishStrategy.test.ts src/tools/ai-lib-tools/__tests__/text-editor.security.test.ts
pnpm --filter website test -- 'app/src/app/[market]/develop/components/settings/DisplayAds/DisplayAdsPanel.test.tsx' 'app/src/app/[market]/develop/components/settings/useSettingsNavItems.test.tsx' 'app/src/app/[market]/develop/components/settings/SettingsMenu.test.tsx'
npm --prefix app-templates/v8 test -- src/server/adsense-manifest.test.ts src/server/entry.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Run typechecks**

```bash
pnpm --filter @airo/shared typecheck
pnpm --filter @airo/agents typecheck
pnpm --filter website typecheck
npm --prefix app-templates/v8 run type-check
```

Expected: all PASS.

- [ ] **Step 3: Run lint for touched packages**

```bash
pnpm --filter @airo/shared lint
pnpm --filter @airo/agents lint
pnpm --filter website lint
npm --prefix app-templates/v8 run lint
```

Expected: all PASS.

- [ ] **Step 4: Manual publish smoke test**

Use local dev only after the targeted tests pass:

```bash
pnpm run dev
```

In the builder UI:

1. Open the settings menu.
2. Select `Display Ads`.
3. Paste this test snippet:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456" crossorigin="anonymous"></script>
```

4. Enable `ads.txt` and enter:

```text
google.com, pub-123, DIRECT, f08c47fec0942fa0
```

5. Enable `app-ads.txt` and enter:

```text
google.com, pub-123, DIRECT, f08c47fec0942fa0
```

6. Save.
7. Publish the app.
8. Fetch the published root HTML and verify it contains `pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456`.
9. Fetch `/ads.txt` and `/app-ads.txt`; both should return HTTP 200 and the saved content.
10. Disable `ads.txt`, clear the script, save, publish again, and verify the root HTML omits the script and `/ads.txt` returns 404.

- [ ] **Step 5: Verify no unexpected selector breakage**

Run:

```bash
rg -n "chat-toolbar-settings-button|settings-feedback-item|builder_settings_nav" tests/e2e tests/regression
```

If any test assumes settings item position, update it to select the exact label/test ID.

- [ ] **Step 6: Final repo checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional files modified.

---

## Acceptance Criteria Coverage

- Dedicated AdSense settings panel: Task 4.
- Paste snippet and reject invalid input: Task 1 and Task 4.
- Independent `ads.txt` and `app-ads.txt` toggles/content: Task 1 and Task 4.
- Values persist across sessions: Task 2 and Task 4 query reload.
- Snippet present in published `<head>`: Task 3, Task 5 `entry.test.ts`, and the Publish Delivery Gate.
- `/ads.txt` and `/app-ads.txt` served at root when enabled: Task 5.
- Disabling toggles removes files from next publish: Task 3 writes an empty/updated manifest before every publish; Task 5 returns 404 when disabled; the Publish Delivery Gate verifies a repeated publish overwrites the manifest with disabled delivery.
- Clearing snippet removes it from next publish: Task 1 normalizes empty snippet; Task 3 writes it; Task 5 omits head HTML.
- Storage shape documented and aligned: `2026-06-03-manual-adsense-integration-design.md`, this plan, shared contract, `.airo/adsense.json` authoring state, and generated `dist/airo-adsense.json` runtime output.

## Open Implementation Notes

- `appbuilder-settings-display-ads` should be created in Switchboard before QA uses the panel. Keep default `false` until ready.
- PaaS access remains denied by default because this ticket is manual AAB UI scope.
- If UX chooses `AdSense` instead of `Display Ads` for the nav label, only the i18n key value should change; keep code enum/route names stable.
- The implementation should not inject raw saved script HTML. Runtime head output must be generated from the normalized publisher ID.
