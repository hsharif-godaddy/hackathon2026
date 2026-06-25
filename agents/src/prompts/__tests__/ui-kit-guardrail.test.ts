import { describe, it, expect } from 'vitest'
import { UI_KIT_COPY_GUARDRAIL } from '../ui-kit-guardrail.js'

describe('UI_KIT_COPY_GUARDRAIL', () => {
  it('treats example business copy as placeholder, never to be reused', () => {
    expect(UI_KIT_COPY_GUARDRAIL).toContain('as placeholder; never reuse it')
    expect(UI_KIT_COPY_GUARDRAIL).toContain("Always write the customer's own content")
  })

  // The carve-out is the subtle part: it must NOT over-suppress legitimate
  // control text. Pin the exact clause so a future edit can't quietly drop it.
  it('carves out conventional UI labels so control text is not over-suppressed', () => {
    expect(UI_KIT_COPY_GUARDRAIL).toContain(
      'Conventional UI labels (e.g. "Submit", "Email", "Learn more", nav items, aria-labels) may follow the kit\'s patterns.',
    )
  })
})
