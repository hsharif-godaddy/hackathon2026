import { describe, it, expect, vi } from 'vitest'
import { updateCssRadius, updateCssButtonRadius } from '../radius-css.js'

/**
 * Build a minimal WorkspaceFiles double backed by an in-memory file map, exposing
 * just the `view`/`write` surface updateCssRadius uses.
 */
function mockFiles(initial: Record<string, string>): {
  files: { view: (o: { path: string }) => Promise<{ content: string }>; readText: (o: { path: string }) => Promise<string>; write: (o: { path: string; content: string }) => Promise<void> }
  store: Record<string, string>
} {
  const store: Record<string, string> = { ...initial }
  return {
    store,
    files: {
      view: vi.fn(async ({ path }: { path: string }) => {
        if (!(path in store)) throw new Error(`not found: ${path}`)
        return { content: store[path]! }
      }),
      readText: vi.fn(async ({ path }: { path: string }) => {
        if (!(path in store)) throw new Error(`not found: ${path}`)
        return store[path]!
      }),
      write: vi.fn(async ({ path, content }: { path: string; content: string }) => {
        store[path] = content
      }),
    },
  }
}

const GLOBALS = 'src/styles/globals.css'
const TEMPLATE = `@layer base {
  :root {
    --primary: 0 0% 0%;
    /* Border Radius */
    --radius: 0.5rem;
    --font-sans: "X";
  }
}`

describe('updateCssRadius', () => {
  it('replaces the template --radius with the kit value in px, preserving indentation', async () => {
    const { files, store } = mockFiles({ [GLOBALS]: TEMPLATE })
    const res = await updateCssRadius(files as never, 18)
    expect(res).toBe(true)
    expect(store[GLOBALS]).toContain('    --radius: 18px;') // indentation re-emitted via $1
    expect(store[GLOBALS]).not.toContain('--radius: 0.5rem;')
  })

  it('writes 0px for a flat kit (radiusBase 0)', async () => {
    const { files, store } = mockFiles({ [GLOBALS]: TEMPLATE })
    const res = await updateCssRadius(files as never, 0)
    expect(res).toBe(true)
    expect(store[GLOBALS]).toContain('--radius: 0px;')
  })

  it('returns false for a non-finite or negative radius, leaving content unchanged', async () => {
    const { files, store } = mockFiles({ [GLOBALS]: TEMPLATE })
    expect(await updateCssRadius(files as never, Number.NaN)).toBe(false)
    expect(await updateCssRadius(files as never, -4)).toBe(false)
    expect(store[GLOBALS]).toBe(TEMPLATE)
  })

  it('only touches the --radius line — other vars are preserved', async () => {
    const { files, store } = mockFiles({ [GLOBALS]: TEMPLATE })
    await updateCssRadius(files as never, 12)
    expect(store[GLOBALS]).toContain('--primary: 0 0% 0%;')
    expect(store[GLOBALS]).toContain('--font-sans: "X";')
  })

  it('does not match --radius-* longhand custom props', async () => {
    const withLonghand = `:root {\n  --radius-sm: 4px;\n  --radius: 0.5rem;\n  --radius-lg: 12px;\n}`
    const { files, store } = mockFiles({ [GLOBALS]: withLonghand })
    await updateCssRadius(files as never, 18)
    expect(store[GLOBALS]).toContain('--radius-sm: 4px;')
    expect(store[GLOBALS]).toContain('--radius-lg: 12px;')
    expect(store[GLOBALS]).toContain('--radius: 18px;')
  })

  it('returns success:false and leaves content unchanged when --radius is absent', async () => {
    const noRadius = `:root {\n  --primary: 0 0% 0%;\n}`
    const { files, store } = mockFiles({ [GLOBALS]: noRadius })
    const res = await updateCssRadius(files as never, 18)
    expect(res).toBe(false)
    expect(store[GLOBALS]).toBe(noRadius)
  })

  it('never throws when the file is missing (best-effort)', async () => {
    const { files } = mockFiles({})
    const res = await updateCssRadius(files as never, 18)
    expect(res).toBe(false)
  })
})

const TEMPLATE_WITH_BUTTON = `@layer base {
  :root {
    /* Border Radius */
    --radius: 0.5rem;
    --radius-button: calc(var(--radius) - 2px);
  }
}`

describe('updateCssButtonRadius', () => {
  it('replaces --radius-button with the kit value in px, preserving indentation', async () => {
    const { files, store } = mockFiles({ [GLOBALS]: TEMPLATE_WITH_BUTTON })
    const res = await updateCssButtonRadius(files as never, 999)
    expect(res).toBe(true)
    expect(store[GLOBALS]).toContain('    --radius-button: 999px;') // pill
    expect(store[GLOBALS]).not.toContain('calc(var(--radius) - 2px)')
  })

  it('writes 0px for a sharp kit (radiusButton 0)', async () => {
    const { files, store } = mockFiles({ [GLOBALS]: TEMPLATE_WITH_BUTTON })
    expect(await updateCssButtonRadius(files as never, 0)).toBe(true)
    expect(store[GLOBALS]).toContain('--radius-button: 0px;')
  })

  it('does not touch the base --radius line', async () => {
    const { files, store } = mockFiles({ [GLOBALS]: TEMPLATE_WITH_BUTTON })
    await updateCssButtonRadius(files as never, 24)
    expect(store[GLOBALS]).toContain('--radius: 0.5rem;') // base untouched
    expect(store[GLOBALS]).toContain('--radius-button: 24px;')
  })

  it('returns false for a non-finite or negative radius, leaving content unchanged', async () => {
    const { files, store } = mockFiles({ [GLOBALS]: TEMPLATE_WITH_BUTTON })
    expect(await updateCssButtonRadius(files as never, Number.NaN)).toBe(false)
    expect(await updateCssButtonRadius(files as never, -4)).toBe(false)
    expect(store[GLOBALS]).toBe(TEMPLATE_WITH_BUTTON)
  })

  it('returns false and leaves content unchanged when --radius-button is absent', async () => {
    const noButton = `:root {\n  --radius: 0.5rem;\n}`
    const { files, store } = mockFiles({ [GLOBALS]: noButton })
    expect(await updateCssButtonRadius(files as never, 18)).toBe(false)
    expect(store[GLOBALS]).toBe(noButton)
  })

  it('never throws when the file is missing (best-effort)', async () => {
    const { files } = mockFiles({})
    expect(await updateCssButtonRadius(files as never, 18)).toBe(false)
  })
})
