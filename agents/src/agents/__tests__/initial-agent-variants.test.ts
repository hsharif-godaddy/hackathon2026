import { describe, it, expect } from 'vitest'
import { discoverNamedInitialVariants } from '../initial-agent.js'

describe('discoverNamedInitialVariants', () => {
  it('includes design-system', () => {
    expect(discoverNamedInitialVariants()).toContain('design-system')
  })

  it('includes design-system-homepage-build', () => {
    expect(discoverNamedInitialVariants()).toContain('design-system-homepage-build')
  })
})
