#!/usr/bin/env node
/**
 * Seed the isolated dev instance for the browser suite.
 *
 * The suite needs a signed-in session, and until now nothing created the
 * account it signs in with: `auth.setup.ts` read a password from
 * `/tmp/arciin-e2e-pw` that no script ever wrote, so every run died at setup
 * with ENOENT and the browser tests had never executed at all.
 *
 * What this guarantees before Playwright starts:
 *
 *   - the dev database has an InstanceConfig, so the app does not redirect to
 *     /setup instead of /login;
 *   - an ACTIVE OWNER account exists with a known password;
 *   - the password is freshly generated per run and written 0600 to a file
 *     outside the repository, so it never lands in git, in a log, or in an
 *     environment variable another process can read.
 *
 * Refuses to run against anything that looks like production.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"

import { config as loadEnv } from "dotenv"
import { hash } from "@node-rs/argon2"
import { PrismaClient } from "@prisma/client"

const repoRoot = path.resolve(import.meta.dirname, "..")
loadEnv({ path: path.join(repoRoot, ".env"), quiet: true })
loadEnv({ path: path.join(repoRoot, ".env.development"), override: true, quiet: true })

export const E2E_EMAIL = "e2e@arciin.invalid"
export const E2E_PASSWORD_FILE = "/tmp/arciin-e2e-pw"

/**
 * The suite writes to this database. Pointing it at production would seed a
 * fake owner into a real instance, so this is a hard stop rather than a warning.
 */
function assertDevDatabase(url) {
  if (!url) throw new Error("DATABASE_URL is not set")
  const name = new URL(url).pathname.replace(/^\//, "")
  if (name !== "arciin_dev") {
    throw new Error(
      `refusing to seed: DATABASE_URL points at "${name}", expected "arciin_dev". ` +
        "Run with .env.development loaded.",
    )
  }
  return name
}

export async function seedE2EUser() {
  const databaseName = assertDevDatabase(process.env.DATABASE_URL)
  const prisma = new PrismaClient()

  try {
    // 24 bytes is well past anything a login rate limiter needs to resist, and
    // the value lives for one test run.
    const password = randomBytes(24).toString("base64url")
    const passwordHash = await hash(password)

    let instance = await prisma.instanceConfig.findFirst()
    if (!instance) {
      instance = await prisma.instanceConfig.create({
        data: {
          instanceName: "Arciin E2E",
          storageRoot: process.env.ARCIIN_DATA_DIR ?? "/srv/arce-projects/arciin-dev-storage",
          initializedAt: new Date(),
        },
      })
    }

    const user = await prisma.user.upsert({
      where: { email: E2E_EMAIL },
      create: {
        email: E2E_EMAIL,
        name: "E2E Runner",
        passwordHash,
        role: "OWNER",
        status: "ACTIVE",
      },
      // Rotate the password every run so a leaked file is worthless afterwards.
      update: { passwordHash, status: "ACTIVE", role: "OWNER" },
      select: { id: true, email: true },
    })

    mkdirSync(path.dirname(E2E_PASSWORD_FILE), { recursive: true })
    writeFileSync(E2E_PASSWORD_FILE, password, { mode: 0o600 })
    chmodSync(E2E_PASSWORD_FILE, 0o600)

    return { databaseName, email: user.email, instanceId: instance.id }
  } finally {
    await prisma.$disconnect()
  }
}

// Allow `node scripts/e2e-seed.mjs` as well as import from globalSetup.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  seedE2EUser()
    .then((result) => {
      console.log(
        `seeded ${result.email} in ${result.databaseName}; password written to ${E2E_PASSWORD_FILE}`,
      )
    })
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}
