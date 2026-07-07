import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { updateCssColorPalette } from '../../../tools/css-color-tool.js'
import { updateCssFontVariables } from '../../../tools/ai-lib-tools/font-theme.js'
import { updateCssButtonRadius } from '../radius-css.js'

// Reproduce, deterministically and build-free, exactly what applyKitDesignTokens
// does to globals.css: colors first, then fonts. If this corrupts the file
// (e.g. an unbalanced brace → "unclosed block"), the preview can't compile and
// the agent burns its turn "fixing" CSS instead of building → empty canvas.

const TEMPLATE_CSS = readFileSync(
  join(process.cwd(), '..', 'app-templates', 'v8', 'src', 'styles', 'globals.css'),
  'utf-8',
)

const TEMPLATE_BUTTON = readFileSync(
  join(process.cwd(), '..', 'app-templates', 'v8', 'src', 'components', 'ui', 'button.tsx'),
  'utf-8',
)

function makeFiles(initial: string) {
  let content = initial
  return {
    files: {
      view: async () => ({ content }),
      readText: async () => content,
      write: async ({ content: c }: { content: string }) => { content = c; return { bytesWritten: c.length } },
    } as unknown as Parameters<typeof updateCssColorPalette>[0],
    get: () => content,
  }
}

function braceBalance(css: string): number {
  return (css.match(/\{/g)?.length ?? 0) - (css.match(/\}/g)?.length ?? 0)
}

describe('design-kit CSS surgery integrity (globals.css)', () => {
  it('template starts balanced', () => {
    expect(braceBalance(TEMPLATE_CSS)).toBe(0)
  })

  it('applying Obsidian colors then fonts keeps globals.css balanced + valid', async () => {
    const fs = makeFiles(TEMPLATE_CSS)
    // 1. Colors (Obsidian palette), same as applyKitDesignTokens.
    const colorRes = await updateCssColorPalette(fs.files, {
      primary: '#ffffff', background: '#000000', foreground: '#ffffff',
      accent: '#ffffff', muted: '#8a8a8a', border: '#000000',
    } as any)
    expect(colorRes.success).toBe(true)
    expect(braceBalance(fs.get())).toBe(0)

    // 2. Fonts (Sora/Manrope), same as applyKitDesignTokens.
    const fontRes = await updateCssFontVariables(
      fs.files as any,
      { name: 'Sora', weights: ['700'], category: 'sans-serif' },
      { name: 'Manrope', weights: ['400', '700'], category: 'sans-serif' },
    )
    expect(fontRes.success).toBe(true)

    const out = fs.get()
    // The smoking gun if our surgery is the cause of the empty canvas:
    expect(braceBalance(out)).toBe(0)
    // @keyframes must not get orphaned / duplicated, and @import must be at top.
    expect((out.match(/@keyframes fadeIn/g) ?? []).length).toBe(1)
    expect((out.match(/body \{/g) ?? []).length).toBe(1)
    expect((out.match(/:root \{/g) ?? []).length).toBe(1)
  })

  it('applying Aether colors then fonts keeps globals.css balanced + valid', async () => {
    const fs = makeFiles(TEMPLATE_CSS)
    // Aether palette (from catalog) — colorScheme input only takes the named hexes.
    const colorRes = await updateCssColorPalette(fs.files, {
      primary: '#1f3fc4', background: '#ffffff', foreground: '#0f0f10',
      accent: '#1f3fc4', muted: '#8a9095', border: '#c5cbce',
    } as any)
    expect(colorRes.success).toBe(true)
    expect(braceBalance(fs.get())).toBe(0)

    // Aether typography — SAME family for header + body, name contains a space.
    const fontRes = await updateCssFontVariables(
      fs.files as any,
      { name: 'Inter Tight', weights: ['700'], category: 'sans-serif' },
      { name: 'Inter Tight', weights: ['400', '700'], category: 'sans-serif' },
    )
    expect(fontRes.success).toBe(true)

    const out = fs.get()
    expect(braceBalance(out)).toBe(0)
    expect((out.match(/@keyframes fadeIn/g) ?? []).length).toBe(1)
    expect((out.match(/body \{/g) ?? []).length).toBe(1)
    expect((out.match(/:root \{/g) ?? []).length).toBe(1)
  })
})

// AIROBUILD-2976 — kit button radius via --radius-button. Validates the real
// template contract end-to-end (not the in-memory fixtures the writer's unit
// tests use): the install-time writer targets a real declaration, and the
// template Button actually consumes the variable. A regression on either side
// (drop the declaration, or revert the Button to a literal rounded-md) silently
// defeats the fix, so it is guarded here against the shipped template files.
describe('kit button radius (--radius-button) contract', () => {
  it('the real template globals.css declares --radius-button for the writer to target', () => {
    expect(TEMPLATE_CSS).toMatch(/--radius-button:\s*[^;]+;/)
  })

  it('the real Button cva consumes rounded-[var(--radius-button)] and keeps no literal button rounded-* ', () => {
    expect(TEMPLATE_BUTTON).toContain('rounded-[var(--radius-button)]')
    // A literal rounded-md in the Button would override the variable via
    // tailwind-merge and silently defeat the kit's button radius.
    expect(TEMPLATE_BUTTON).not.toMatch(/\brounded-md\b/)
  })

  it('updateCssButtonRadius rewrites the real template declaration and keeps globals.css balanced (pill kit)', async () => {
    const fs = makeFiles(TEMPLATE_CSS)
    const ok = await updateCssButtonRadius(fs.files as any, 999)
    expect(ok).toBe(true)
    const out = fs.get()
    expect(out).toContain('--radius-button: 999px;')
    expect(braceBalance(out)).toBe(0)
    expect((out.match(/:root \{/g) ?? []).length).toBe(1)
  })

  it('button radius survives a full colors + fonts + radius surgery pass without corruption (sharp kit)', async () => {
    const fs = makeFiles(TEMPLATE_CSS)
    await updateCssColorPalette(fs.files, {
      primary: '#1f3fc4', background: '#ffffff', foreground: '#0f0f10',
      accent: '#1f3fc4', muted: '#8a9095', border: '#c5cbce',
    } as any)
    await updateCssFontVariables(
      fs.files as any,
      { name: 'Inter Tight', weights: ['700'], category: 'sans-serif' },
      { name: 'Inter Tight', weights: ['400', '700'], category: 'sans-serif' },
    )
    const ok = await updateCssButtonRadius(fs.files as any, 0)
    expect(ok).toBe(true)
    const out = fs.get()
    expect(out).toContain('--radius-button: 0px;')
    expect(braceBalance(out)).toBe(0)
  })
})
