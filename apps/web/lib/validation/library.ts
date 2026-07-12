import { z } from "zod"

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, "Folder name is required.").max(100),
  parentFolderId: z.preprocess(
    (v) => (v === null || v === undefined || v === "" ? undefined : v),
    z.string().optional(),
  ),
})

export type CreateFolderSchema = z.infer<typeof createFolderSchema>
