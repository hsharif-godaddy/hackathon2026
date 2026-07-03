import { z } from 'zod';

/**
 * The verdict vocabulary an LLM judge may emit. Legacy tokens
 * (partial/unknown/observed) and the harness-only 'directional'
 * verdict are intentionally excluded: judges score on this closed set,
 * and any other token fails the schema and falls closed to 'incomplete'.
 */
export const JudgeVerdictSchema = z.enum(['pass', 'fail', 'incomplete']);

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

/**
 * Extract the outermost JSON object substring from an LLM response by
 * slicing between the first '{' and last '}'. Returns null when no
 * balanced-looking span is present. Does NOT strip code fences.
 */
export function extractJsonObject(text: string): string | null {
  const start: number = text.indexOf('{');
  const end: number = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}
