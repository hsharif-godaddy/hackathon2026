import { createTool } from '@airo/ai-lib'
import { z } from 'zod'

export const calculatorTool = createTool(
  'Perform mathematical calculations',
  z.object({
    expression: z.string().describe('Mathematical expression to evaluate (e.g., "2 + 3 * 4")')
  }),
  async ({ expression }: { expression: string }) => {
    try {
      // Simple math evaluator (in production, use a safer math parser)
      const result = Function(`"use strict"; return (${expression})`)()
      return { result: Number(result), expression, success: true }
    } catch {
      return { error: 'Invalid mathematical expression', expression, success: false }
    }
  }
)
