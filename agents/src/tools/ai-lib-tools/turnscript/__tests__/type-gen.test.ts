import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { generateTurnscriptTypes } from '../type-gen.js'

describe('turnscript-type-gen', () => {
  describe('#generateTurnscriptTypes', () => {
    it('renders a turnscript declaration with one method per tool', () => {
      const out = generateTurnscriptTypes({
        readFile: z.object({
          path: z.string(),
          offset: z.number().int().min(0).optional(),
        }),
      })

      expect(out).toContain('declare const turnscript:')
      expect(out).toContain('readFile(input:')
      expect(out).toContain('): Promise<string>')
      expect(out).toContain('path: string')
      // optional field renders with `?`
      expect(out).toMatch(/offset\?: number/)
    })

    it('renders enums and command unions from a str_replace-shaped schema', () => {
      const out = generateTurnscriptTypes({
        str_replace_based_edit_tool: z.object({
          command: z.enum(['view', 'str_replace', 'create', 'insert']),
          view_range: z.array(z.number().int()).optional(),
        }),
      })

      expect(out).toContain('str_replace_based_edit_tool(input:')
      expect(out).toContain('Array<number>')
      expect(out).toContain('"str_replace"')
      expect(out).toContain('"insert"')
    })

    it('quotes non-identifier keys (e.g. grepSearch flags like -i)', () => {
      const out = generateTurnscriptTypes({
        grepSearch: z.object({
          pattern: z.string(),
          '-i': z.boolean().optional(),
        }),
      })

      expect(out).toContain('pattern: string')
      // non-identifier key must be quoted to stay valid in the type literal
      expect(out).toContain('"-i"?: boolean')
    })
  })
})
