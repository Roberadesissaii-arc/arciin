import path from "node:path"
import { fileURLToPath } from "node:url"

import { config as loadEnv } from "dotenv"
import { z } from "zod"

import { defaultLicenseSigningSecret } from "@arciin/config"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
loadEnv({ path: path.join(rootDir, ".env") })
loadEnv() // monorepo root .env as fallback

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LICENSE_SERVER_PORT: z.coerce.number().int().positive().default(4100),
  LICENSE_DATABASE_URL: z
    .string()
    .default(`file:${path.join(rootDir, "data", "licenses.db")}`),
  LICENSE_SIGNING_SECRET: z.string().min(16).default(defaultLicenseSigningSecret()),
  /** Optional shared secret for POST /licenses/demo (empty = open in dev). */
  LICENSE_DEMO_SECRET: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(8).optional(),
  ),
})

const parsed = schema.parse(process.env)

export const licenseServerConfig = {
  ...parsed,
  rootDir,
  isProduction: parsed.NODE_ENV === "production",
}
