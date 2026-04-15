import { z } from 'zod';

export const SkillCaseSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  expectedSkill: z.string().nullable(),
  tags: z.array(z.string()).optional().default([]),
  rationale: z.string().optional(),
  skip: z.boolean().optional().default(false),
  skipReason: z.string().optional(),
});

export const SkillCorpusSchema = z.object({
  metadata: z.object({ name: z.string(), version: z.string() }),
  cases: z.array(SkillCaseSchema),
});

export type SkillCase = z.infer<typeof SkillCaseSchema>;
export type SkillCorpus = z.infer<typeof SkillCorpusSchema>;

export interface SkillCaseResult {
  caseId: string;
  prompt: string;
  expectedSkill: string | null;
  actualSkill: string | null;
  passed: boolean;
  failures: string[];
  latencyMs: number;
  tags: string[];
}
