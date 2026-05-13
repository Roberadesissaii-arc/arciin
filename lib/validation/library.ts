import { z } from "zod"

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, "Folder name is required.").max(100),
  parentFolderId: z.string().optional(),
})

export type CreateFolderSchema = z.infer<typeof createFolderSchema>
