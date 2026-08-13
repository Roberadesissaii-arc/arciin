import { z } from "zod"

const defaultLibraries = ["Videos", "Images", "Music", "Documents", "Inbox"] as const

/** Step 1 — instance identity + where files live. */
export const setupInstanceSchema = z.object({
  setupToken: z.string().min(1, "Setup token is required."),
  instanceName: z.string().min(2, "Instance name must be at least 2 characters."),
  storageRoot: z.string().min(1, "Storage root is required."),
})

/** Step 2 — first owner account. */
export const setupOwnerSchema = z
  .object({
    adminName: z.string().min(2, "Admin name must be at least 2 characters."),
    adminEmail: z.email("Enter a valid admin email."),
    adminPassword: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(8, "Confirm the password."),
  })
  .refine((value) => value.adminPassword === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })

const setupAccountSchema = setupInstanceSchema.merge(
  z.object({
    adminName: z.string().min(2, "Admin name must be at least 2 characters."),
    adminEmail: z.email("Enter a valid admin email."),
    adminPassword: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(8, "Confirm the password."),
  }),
)

/** @deprecated Prefer setupInstanceSchema + setupOwnerSchema; kept for callers. */
export const setupDetailsSchema = setupAccountSchema.refine(
  (value) => value.adminPassword === value.confirmPassword,
  {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  },
)

export const setupSchema = setupAccountSchema
  .extend({
    libraries: z.array(z.enum(defaultLibraries)).min(1, "Select at least one library."),
    acceptedTermsAndPrivacy: z.boolean().refine((value) => value === true, {
      message:
        "You must read and agree to the Terms of Use and Privacy Policy before claiming this instance.",
    }),
  })
  .refine((value) => value.adminPassword === value.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })

export const setupLibraryOptions = [...defaultLibraries]

export type SetupSchema = z.infer<typeof setupSchema>
export type SetupStep = 1 | 2 | 3

export const setupStepFields = {
  1: ["setupToken", "instanceName", "storageRoot"],
  2: ["adminName", "adminEmail", "adminPassword", "confirmPassword"],
  3: ["libraries", "acceptedTermsAndPrivacy"],
} as const satisfies Record<SetupStep, readonly (keyof SetupSchema)[]>
