import path from "node:path"
import { fileURLToPath } from "node:url"

import { config as loadEnv } from "dotenv"
import { z } from "zod"

import { defaultLicenseSigningSecret } from "@arciin/config"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
/** The monorepo root, from this file rather than from wherever it was launched. */
const repoRoot = path.resolve(rootDir, "..", "..")

/**
 * This app's own .env first, then the monorepo's.
 *
 * The root file used to be loaded as a bare `loadEnv()`, which resolves against
 * `process.cwd()` — and `pnpm --filter @arciin/license-server start` runs with
 * the cwd set to *this package*, not the repo. So both calls looked at the same
 * missing `apps/license-server/.env`, `LICENSE_SIGNING_SECRET` fell through to
 * its development default, and the server signed tokens the API could not
 * verify: "License server returned a token that failed local verification."
 *
 * It worked when launched from the root and failed under pm2 and pnpm, which is
 * the worst version of this bug — the same code, two different secrets,
 * depending on where you happened to be standing.
 *
 * Resolved from this file's own location, so where it is started makes no
 * difference. dotenv does not overwrite variables that are already set, so a
 * real environment still wins over both files.
 */
loadEnv({ path: path.join(rootDir, ".env") })
loadEnv({ path: path.join(repoRoot, ".env") })

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
