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

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { createHash, randomBytes } from "node:crypto"

import { config as loadEnv } from "dotenv"
import { hash } from "@node-rs/argon2"
import { PrismaClient } from "@prisma/client"

const repoRoot = path.resolve(import.meta.dirname, "..")
loadEnv({ path: path.join(repoRoot, ".env"), quiet: true })
loadEnv({ path: path.join(repoRoot, ".env.development"), override: true, quiet: true })

export const E2E_EMAIL = "e2e@arciin.invalid"
export const E2E_PASSWORD_FILE = "/tmp/arciin-e2e-pw"

/**
 * The video the transcript suite works on.
 *
 * A stable id, because the spec locates the card by it; a committed source
 * file, because the suite used to depend on a row somebody had seeded by hand
 * and bytes that existed only on one machine. A fresh checkout against a clean
 * database could not run the transcript tests at all, and the failure looked
 * like a broken feature rather than a missing fixture.
 *
 * Ten seconds and 228 KB: short enough to transcribe cheaply, real speech
 * rather than a tone, so the assertion about what the transcript *says* means
 * something.
 */
export const E2E_VIDEO_ASSET_ID = "e2e-video-transcript-fixture"
export const E2E_VIDEO_STORAGE_OBJECT_ID = "e2e-video-transcript-object"
export const E2E_VIDEO_FILENAME = "e2e-video-transcript-fixture.mp4"
export const E2E_VIDEO_SOURCE = path.join(
  path.resolve(import.meta.dirname, ".."),
  "tests/fixtures/e2e-video-transcript-fixture.mp4",
)

/** Properties of the committed file. Checked against it by the seed test. */
export const E2E_VIDEO_METADATA = {
  durationSeconds: 10.005,
  width: 640,
  height: 360,
  codec: "h264",
  mimeType: "video/mp4",
}

/**
 * Where a checksum lands under the storage root.
 *
 * Mirrors `createObjectStoragePath` in the API's local-storage service — the
 * layout uploads actually produce. Duplicated rather than imported because this
 * script runs under plain `node` and that module is TypeScript wired to the API
 * config; `tests/e2e-fixture-seed.test.ts` asserts the two agree, so a change to
 * the real one cannot silently leave the fixture somewhere the app won't look.
 */
export function fixtureObjectKey(checksumSha256, extension) {
  const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  return path.join(
    "objects",
    checksumSha256.slice(0, 2),
    checksumSha256.slice(2, 4),
    `${checksumSha256}${ext}`,
  )
}

/** The five libraries a real instance starts with. */
const DEFAULT_LIBRARIES = [
  ["Videos", "videos", "VIDEO"],
  ["Images", "images", "IMAGE"],
  ["Music", "music", "AUDIO"],
  ["Documents", "documents", "DOCUMENT"],
  ["Inbox", "inbox", "INBOX"],
]

/**
 * Put the fixture video in place, exactly once.
 *
 * Idempotent at every step: the object row is keyed on the content hash, the
 * asset on a fixed id, and the bytes are only copied when they are not already
 * there. Running the seed twice leaves one video, not two.
 */
async function seedVideoFixture(prisma, ownerId, storageRoot) {
  if (!existsSync(E2E_VIDEO_SOURCE)) {
    throw new Error(
      `missing fixture ${E2E_VIDEO_SOURCE}. It is committed to the repository; ` +
        "a clean checkout should have it.",
    )
  }

  const bytes = readFileSync(E2E_VIDEO_SOURCE)
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex")
  const sizeBytes = statSync(E2E_VIDEO_SOURCE).size
  const objectKey = fixtureObjectKey(checksumSha256, ".mp4")
  const physicalPath = path.join(storageRoot, objectKey)

  // The bytes, under the dev storage root the API will read them from.
  if (!existsSync(physicalPath)) {
    mkdirSync(path.dirname(physicalPath), { recursive: true })
    copyFileSync(E2E_VIDEO_SOURCE, physicalPath)
  }

  const storageLocation =
    (await prisma.storageLocation.findFirst({ where: { isDefault: true } })) ??
    (await prisma.storageLocation.create({
      data: { name: "Dev Storage", type: "LOCAL", rootPath: storageRoot, isDefault: true },
    }))

  const libraries = {}
  for (const [name, slug, kind] of DEFAULT_LIBRARIES) {
    libraries[slug] = await prisma.library.upsert({
      where: { slug },
      create: { name, slug, kind, storageLocationId: storageLocation.id },
      update: {},
      select: { id: true },
    })
  }

  // Keyed on objectKey, which is unique and content-derived: re-seeding the
  // same file finds the same row instead of inserting a rival one.
  const existingObject = await prisma.storageObject.findUnique({ where: { objectKey } })
  const storageObject =
    existingObject ??
    (await prisma.storageObject.create({
      data: {
        id: E2E_VIDEO_STORAGE_OBJECT_ID,
        storageLocationId: storageLocation.id,
        objectKey,
        physicalPath,
        sizeBytes: BigInt(sizeBytes),
        checksumSha256,
        mimeType: E2E_VIDEO_METADATA.mimeType,
      },
    }))

  const assetData = {
    libraryId: libraries.videos.id,
    folderId: null,
    storageObjectId: storageObject.id,
    ownerId,
    filename: E2E_VIDEO_FILENAME,
    originalFilename: E2E_VIDEO_FILENAME,
    mimeType: E2E_VIDEO_METADATA.mimeType,
    mediaType: "VIDEO",
    extension: "mp4",
    sizeBytes: BigInt(sizeBytes),
    checksumSha256,
    durationSeconds: E2E_VIDEO_METADATA.durationSeconds,
    width: E2E_VIDEO_METADATA.width,
    height: E2E_VIDEO_METADATA.height,
    codec: E2E_VIDEO_METADATA.codec,
    status: "READY",
    deletedAt: null,
  }

  await prisma.asset.upsert({
    where: { id: E2E_VIDEO_ASSET_ID },
    create: { id: E2E_VIDEO_ASSET_ID, ...assetData },
    // Re-point rather than duplicate, so replacing the fixture file works.
    update: assetData,
  })

  return { assetId: E2E_VIDEO_ASSET_ID, objectKey, physicalPath, sizeBytes }
}

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

    // The instance is seeded Pro because the entitlement suite tests Pro
    // behaviour, and the plan is decided server-side: the chat page renders the
    // soft-lock before any browser route stub can intervene, so a Free instance
    // made every Pro test fail on a paywall that was correctly shown. Tests
    // that need Free stub the license endpoint and drive the client-side state.
    const licence = {
      licensePlan: "pro",
      licenseStatus: "active",
      licenseSource: "mock_dev",
      licenseActivatedAt: new Date(),
      licenseExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    }

    let instance = await prisma.instanceConfig.findFirst()
    if (!instance) {
      instance = await prisma.instanceConfig.create({
        data: {
          instanceName: "Arciin E2E",
          storageRoot: process.env.ARCIIN_DATA_DIR ?? "/srv/arce-projects/arciin-dev-storage",
          initializedAt: new Date(),
          ...licence,
        },
      })
    } else {
      instance = await prisma.instanceConfig.update({ where: { id: instance.id }, data: licence })
    }

    // A chat profile must exist or the chat page renders its "no models
    // configured" empty state instead of the entitlement UI, and the gating
    // assertions look for a banner that was never going to be there. No API
    // key: nothing in the browser suite sends a real completion.
    const existingProfile = await prisma.modelProfile.findFirst({
      where: { provider: "ollama" },
      select: { id: true },
    })
    if (!existingProfile) {
      await prisma.modelProfile.create({
        data: {
          provider: "ollama",
          displayName: "E2E Local",
          baseUrl: "http://127.0.0.1:11434",
          defaultModel: "llama3.2",
          isDefault: true,
          isEnabled: true,
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

    const storageRoot =
      process.env.ARCIIN_DATA_DIR ?? instance.storageRoot ?? "/srv/arce-projects/arciin-dev-storage"
    const video = await seedVideoFixture(prisma, user.id, storageRoot)

    return { databaseName, email: user.email, instanceId: instance.id, video }
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
      console.log(
        `video fixture ${result.video.assetId} ready (${Math.round(result.video.sizeBytes / 1024)} KB)`,
      )
    })
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}
