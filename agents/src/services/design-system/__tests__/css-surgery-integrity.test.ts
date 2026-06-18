import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { updateCssColorPalette } from '../../../tools/css-color-tool.js'
import { updateCssFontVariables } from '../../../tools/ai-lib-tools/font-theme.js'

// Reproduce, deterministically and build-free, exactly what applyKitDesignTokens
// does to globals.css: colors first, then fonts. If this corrupts the file
// (e.g. an unbalanced brace → "unclosed block"), the preview can't compile and
// the agent burns its turn "fixing" CSS instead of building → empty canvas.

const TEMPLATE_CSS = readFileSync(
  join(process.cwd(), '..', 'app-templates', 'v8', 'src', 'styles', 'globals.css'),
  'utf-8',
)

function makeFiles(initial: string) {
  let content = initial
  return {
    files: {
      view: async () => ({ content }),
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
