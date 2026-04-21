import { z } from 'zod'

export const ProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  properties: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()])
  ),
})

export type ProfileData = z.infer<typeof ProfileSchema>
