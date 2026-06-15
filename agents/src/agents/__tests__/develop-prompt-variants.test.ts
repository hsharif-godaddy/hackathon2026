import { describe, it, expect } from 'vitest'
import {
  resolveEvalPromptVariants,
  injectedFileNames,
  replacedFragmentNames,
  REPLACEABLE_FRAGMENTS,
  type EvalPromptVariant,
} from '../develop-prompt-variants.js'

/**
 * Build resolver args with controllable flag/exists probes. By default every
 * flag is off and every file exists, so each test flips only what it asserts.
 */
function makeArgs(
  variants: readonly EvalPromptVariant[],
  opts: { setFlags?: string[]; missingFiles?: string[] } = {},
) {
  const setFlags = new Set(opts.setFlags ?? [])
  const missingFiles = new Set(opts.missingFiles ?? [])
  return {
    variants,
    isFlagSet: (flag: string) => setFlags.has(flag),
    resolveVariantPath: (fileName: string) => `/experiments/${fileName}`,
    exists: (path: string) => !missingFiles.has(path),
  }
}

describe('resolveEvalPromptVariants', () => {
  const exampleArm: EvalPromptVariant = {
    flag: 'develop.exampleArm',
    fileName: 'example-arm.md',
    position: 'append',
  }

  it('is inert when no flag is set (byte-identical baseline)', () => {
    const r = resolveEvalPromptVariants(makeArgs([exampleArm]))
    expect(r.prependPaths).toEqual([])
    expect(r.appendPaths).toEqual([])
    expect(r.replacements.size).toBe(0)
    expect(r.active).toEqual({ 'develop.exampleArm': false })
  })

  it('injects an append variant when its flag is set', () => {
    const r = resolveEvalPromptVariants(makeArgs([exampleArm], { setFlags: ['develop.exampleArm'] }))
    expect(r.appendPaths).toEqual(['/experiments/example-arm.md'])
    expect(r.active['develop.exampleArm']).toBe(true)
    expect(injectedFileNames(r)).toEqual(['example-arm.md'])
  })

  it('injects a prepend variant before the prompt', () => {
    const prepend: EvalPromptVariant = { flag: 'develop.framing', fileName: 'framing.md', position: 'prepend' }
    const r = resolveEvalPromptVariants(makeArgs([prepend], { setFlags: ['develop.framing'] }))
    expect(r.prependPaths).toEqual(['/experiments/framing.md'])
    expect(r.appendPaths).toEqual([])
  })

  it('records a replace variant against any replaceable fragment', () => {
    // frontend.md is the case the reviewer flagged as silently broken before.
    const replace: EvalPromptVariant = {
      flag: 'develop.frontendV2',
      fileName: 'frontend-v2.md',
      position: 'replace',
      target: 'frontend.md',
    }
    const r = resolveEvalPromptVariants(makeArgs([replace], { setFlags: ['develop.frontendV2'] }))
    expect(r.replacements.get('frontend.md')).toBe('/experiments/frontend-v2.md')
    expect(replacedFragmentNames(r)).toEqual(['frontend.md'])
    expect(r.active['develop.frontendV2']).toBe(true)
  })

  it('throws fail-closed when an active variant file is missing', () => {
    expect(() =>
      resolveEvalPromptVariants(
        makeArgs([exampleArm], { setFlags: ['develop.exampleArm'], missingFiles: ['/experiments/example-arm.md'] }),
      ),
    ).toThrow(/missing/i)
  })

  it('throws when a replace variant targets a non-replaceable fragment', () => {
    const replace: EvalPromptVariant = {
      flag: 'develop.secV2',
      fileName: 'sec-v2.md',
      position: 'replace',
      target: 'security.md', // intentionally excluded from REPLACEABLE_FRAGMENTS
    }
    expect(() =>
      resolveEvalPromptVariants(makeArgs([replace], { setFlags: ['develop.secV2'] })),
    ).toThrow(/non-replaceable/i)
    expect(REPLACEABLE_FRAGMENTS).not.toContain('security.md')
  })

  it('throws when a replace variant has no target', () => {
    const replace = {
      flag: 'develop.noTarget',
      fileName: 'x.md',
      position: 'replace',
    } as EvalPromptVariant
    expect(() =>
      resolveEvalPromptVariants(makeArgs([replace], { setFlags: ['develop.noTarget'] })),
    ).toThrow(/no target/i)
  })

  it('does not probe or throw for a variant whose flag is off', () => {
    // Even with a missing file and a bad target, an unset flag is a clean no-op.
    const replace: EvalPromptVariant = {
      flag: 'develop.off',
      fileName: 'gone.md',
      position: 'replace',
      target: 'security.md',
    }
    const r = resolveEvalPromptVariants(
      makeArgs([replace], { missingFiles: ['/experiments/gone.md'] }),
    )
    expect(r.active['develop.off']).toBe(false)
    expect(r.replacements.size).toBe(0)
  })
})
