import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string): string => readFileSync(path.join(DIR, file), 'utf8')

describe('3.0 feature-list invariants', function featureListInvariants() {
  it('feature-list requires backend completion in descriptions for deferred preview work', function backendCompletion() {
    const featureList = read('feature-list.md')
    expect(featureList).toContain('visual-only')
    expect(featureList).toContain('full completion scope')
    expect(featureList).toContain('preview-only')
    expect(featureList).toContain('inbox')
    expect(featureList).toContain('commerce')
    expect(featureList).toContain('payment')
  })

  it('feature-list requires placeholder completion when preview shows mock data', function placeholderCompletion() {
    const featureList = read('feature-list.md')
    expect(featureList).toContain('PLACEHOLDER COMPLETION')
    expect(featureList).toContain('mock or placeholder data')
    expect(featureList).toContain('user-provided content replacing placeholders')
  })

  it('feature-list keeps static pages UI-only without invented backend', function staticUiOnly() {
    const featureList = read('feature-list.md')
    expect(featureList).toContain('STATIC STAYS UI-ONLY')
    expect(featureList).toContain('do not invent backend scope')
  })

  it('examples update coffee shop todo list only (no extra scenario blocks)', function examplesCoffeeShop() {
    const examples = read('examples.md')
    expect(examples).toContain('commerce + payment skills')
    expect(examples).toContain('inbox skill + working submissions')
    expect(examples).not.toContain('## Example: Portfolio')
    expect(examples).not.toContain('## Example: Reviews Integration')
    expect(examples).not.toContain('Sparkle Home')
  })
})
