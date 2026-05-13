import { z } from "zod"

export const uploadIntentSchema = z.object({
  targetLibraryId: z.string().optional(),
  targetFolderId: z.string().optional(),
  autoRoute: z.boolean().default(true),
})

export type UploadIntentSchema = z.infer<typeof uploadIntentSchema>
