import { generateKeyPairSync } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { config as loadEnv } from "dotenv"
import { z } from "zod"

import {
  buildPublicKeyRegistry,
  licensePublicKeyFromPrivate,
  parseLicensePrivateKey,
  LICENSE_PUBLIC_KEYS,
} from "@arciin/config"

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
/** The monorepo root, from this file rather than from wherever it was launched. */
const repoRoot = path.resolve(rootDir, "..", "..")

/**
 * This app's own .env first, then the monorepo's.
 *
 * The root file used to be loaded as a bare `loadEnv()`, which resolves against
 * `process.cwd()` — and `pnpm --filter @arciin/license-server start` runs with
 * the cwd set to *this package*, not the repo. So both calls looked at the same
 * missing `apps/license-server/.env`, the signing configuration fell through to
 * a development default, and the server signed tokens the API could not verify.
 *
 * Resolved from this file's own location, so where it is started makes no
 * difference. dotenv does not overwrite variables that are already set, so a
 * real environment still wins over both files.
 */
loadEnv({ path: path.join(rootDir, ".env") })
loadEnv({ path: path.join(repoRoot, ".env") })

/**
 * Comma-separated service credentials, so rotation is add-then-remove rather
 * than a flag day. Empty entries are dropped; a blank variable is treated as
 * unset so the fail-closed check below can report it clearly.
 */
function parseTokenList(value: unknown): string[] {
  if (typeof value !== "string") return []
  return value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LICENSE_SERVER_PORT: z.coerce.number().int().positive().default(4100),
  LICENSE_DATABASE_URL: z
    .string()
    .default(`file:${path.join(rootDir, "data", "licenses.db")}`),

  /**
   * Ed25519 private key (base64url of the 32-byte seed) and the key id it is
   * published under. Never committed, never shipped, never logged.
   */
  LICENSE_SIGNING_KEY: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().optional(),
  ),
  LICENSE_SIGNING_KID: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().optional(),
  ),

  /**
   * Credentials for vendor backends (arciin-web) calling privileged routes.
   * Absent means privileged routes refuse every request — see the guard below.
   */
  LICENSE_SERVICE_TOKENS: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().optional(),
  ),
  /** Separate, stricter credential for destructive maintenance operations. */
  LICENSE_ADMIN_TOKENS: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().optional(),
  ),

  /**
   * Legacy HMAC secret. Only used to verify v2 tokens presented by instances
   * that activated before the Ed25519 migration; never used for signing.
   */
  LICENSE_LEGACY_HMAC_SECRET: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(16).optional(),
  ),

  /** Requests per minute per IP on instance-facing routes. */
  LICENSE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
})

const parsed = schema.parse(process.env)
const isProduction = parsed.NODE_ENV === "production"

/**
 * Development signing key.
 *
 * Generated per process rather than hardcoded: a checked-in default private key
 * is a checked-in forging key, and the whole point of v3 is that no such value
 * exists. Dev instances pick it up through `ARCIIN_LICENSE_PUBLIC_KEYS`, which
 * `scripts/dev-license-keys.mjs` prints.
 */
function developmentSigningKey(): { key: string; kid: string } {
  const { privateKey } = generateKeyPairSync("ed25519")
  const jwk = privateKey.export({ format: "jwk" }) as { d?: string }
  return { key: jwk.d!, kid: "arciin-lic-dev" }
}

function resolveSigning(): { privateKeyRaw: string; kid: string; ephemeral: boolean } {
  if (parsed.LICENSE_SIGNING_KEY) {
    return {
      privateKeyRaw: parsed.LICENSE_SIGNING_KEY,
      kid: parsed.LICENSE_SIGNING_KID ?? LICENSE_PUBLIC_KEYS[0]?.kid ?? "arciin-lic-dev",
      ephemeral: false,
    }
  }
  if (isProduction) {
    throw new Error(
      "LICENSE_SIGNING_KEY is required in production. Generate one with: node scripts/generate-license-signing-key.mjs",
    )
  }
  const dev = developmentSigningKey()
  return { privateKeyRaw: dev.key, kid: dev.kid, ephemeral: true }
}

const signing = resolveSigning()
const signingPrivateKey = parseLicensePrivateKey(signing.privateKeyRaw)
const signingPublicKey = licensePublicKeyFromPrivate(signing.privateKeyRaw)

const serviceTokens = parseTokenList(parsed.LICENSE_SERVICE_TOKENS)
const adminTokens = parseTokenList(parsed.LICENSE_ADMIN_TOKENS)

/**
 * Fail closed in production.
 *
 * The previous design gated privileged routes on an *optional* shared secret,
 * so an unset variable silently opened license minting, revocation, and hard
 * deletion to anyone who could reach the port. Refusing to boot is the only
 * version of this that cannot be misconfigured into being wide open.
 */
if (isProduction && serviceTokens.length === 0) {
  throw new Error(
    "LICENSE_SERVICE_TOKENS must be set in production — privileged licensing routes refuse to run unauthenticated. Generate one with: openssl rand -hex 32",
  )
}

/**
 * Verification registry used for reading tokens the server itself issued
 * (refresh and deactivate accept a token instead of a key). Includes the
 * current signing key so an ephemeral development key verifies its own output.
 */
const publicKeyRegistry = buildPublicKeyRegistry([
  ...LICENSE_PUBLIC_KEYS,
  { kid: signing.kid, publicKey: signingPublicKey },
])

export const licenseServerConfig = {
  ...parsed,
  rootDir,
  isProduction,
  signingPrivateKey,
  signingKid: signing.kid,
  signingPublicKey,
  signingIsEphemeral: signing.ephemeral,
  publicKeyRegistry,
  serviceTokens,
  adminTokens,
  legacyHmacSecret: parsed.LICENSE_LEGACY_HMAC_SECRET ?? null,
}
