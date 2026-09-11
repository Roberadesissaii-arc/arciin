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
import { createHash, randomBytes, createHmac } from "node:crypto"

import { config as loadEnv } from "dotenv"
import { hash } from "@node-rs/argon2"
import { PrismaClient } from "@prisma/client"

const repoRoot = path.resolve(import.meta.dirname, "..")
loadEnv({ path: path.join(repoRoot, ".env"), quiet: true })
loadEnv({ path: path.join(repoRoot, ".env.development"), override: true, quiet: true })

export const E2E_EMAIL = "e2e@arciin.invalid"
export const E2E_PASSWORD_FILE = "/tmp/arciin-e2e-pw"
export const E2E_ROLE_PASSWORD_FILE = "/tmp/arciin-e2e-role-users.json"
export const E2E_ADMIN_EMAIL = "e2e-admin@arciin.invalid"
export const E2E_MEMBER_EMAIL = "e2e-member@arciin.invalid"
export const E2E_VIEWER_EMAIL = "e2e-viewer@arciin.invalid"

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
/**
 * A second video that has nothing happening on it.
 *
 * The card tests need a quiet row to contrast against the busy one — no AI
 * activity, no translations — and they address it by this id. It existed only
 * as a hand-made row in the long-lived arciin_dev database, so the suite
 * silently required a database nobody could recreate: on a freshly migrated
 * one, every test touching it failed on a card that was never seeded. Same
 * bytes as the transcript fixture; only its emptiness matters.
 */
export const E2E_QUIET_VIDEO_ASSET_ID = "dev-video-promo"
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
 * A still, so the asset panel's image behaviour can be tested for real.
 *
 * A frame of the video rather than a separate download: deterministic, tiny,
 * and it needs no second source of truth. Without it the "an image shows no
 * transcript controls" acceptance could only ever be argued from the code.
 */
export const E2E_IMAGE_ASSET_ID = "e2e-image-fixture"
export const E2E_IMAGE_FILENAME = "e2e-image-fixture.png"
export const E2E_IMAGE_SOURCE = path.join(
  path.resolve(import.meta.dirname, ".."),
  "tests/fixtures/e2e-image-fixture.png",
)
export const E2E_IMAGE_METADATA = {
  width: 480,
  height: 270,
  mimeType: "image/png",
}

/**
 * A PDF, so "a document is offered Assist" can be asserted against a document
 * we control.
 *
 * The suite used to reach for whatever the documents library happened to list
 * first. That library accumulates whatever earlier work left behind — on this
 * machine the newest document was a realtime-probe.txt from an audit session —
 * and a .txt is correctly *not* offered PDF Assist, so the test failed on a
 * true statement about the wrong file.
 *
 * Hand-written rather than downloaded: 601 bytes, one page, one line of text,
 * and legible as source instead of an opaque blob.
 */
export const E2E_DOC_ASSET_ID = "e2e-doc-fixture"
export const E2E_DOC_FILENAME = "e2e-doc-fixture.pdf"
export const E2E_DOC_SOURCE = path.join(
  path.resolve(import.meta.dirname, ".."),
  "tests/fixtures/e2e-doc-fixture.pdf",
)
export const E2E_DOC_METADATA = {
  mimeType: "application/pdf",
}

/**
 * The translations the transcript suite works with.
 *
 * Two, in different scripts, because the panel's language switching and the
 * card's language count are both about there being more than one — and because
 * a right-to-left script catches layout assumptions a second Latin one would
 * not. Together with the original that is the "3 languages" the card reports.
 */
export const E2E_TRANSLATION_LANGUAGE = "es"
export const E2E_SECOND_TRANSLATION_LANGUAGE = "ar"

/**
 * Lines whose timings are the video's, one per second.
 *
 * Two speakers, because the transcript groups consecutive lines by speaker and a
 * single-speaker fixture would let a grouping bug through unnoticed.
 */
export const E2E_TRANSCRIPT_SEGMENTS = Array.from({ length: 10 }, (_, i) => ({
  startMs: i * 1000,
  endMs: (i + 1) * 1000,
  speaker: i % 2 === 0 ? "Speaker 1" : "Speaker 2",
  text: `This is line ${i + 1} of the fixture.`,
}))

export const E2E_TRANSLATION_SEGMENTS = E2E_TRANSCRIPT_SEGMENTS.map((segment, i) => ({
  ...segment,
  text: `Esta es la linea ${i + 1} del archivo de prueba.`,
}))

/**
 * A transcript and its saved translations, idempotent.
 *
 * Seeded together because they are meaningless apart: a translation without a
 * transcript is not reachable through the API at all.
 */
async function seedTranscriptFixture(prisma, assetId) {
  const transcriptData = {
    status: "READY",
    provider: "seed",
    model: "fixture",
    language: "en",
    fullText: E2E_TRANSCRIPT_SEGMENTS.map((s) => s.text).join("\n"),
    segments: E2E_TRANSCRIPT_SEGMENTS,
    durationSeconds: E2E_VIDEO_METADATA.durationSeconds,
    error: null,
    generatedAt: new Date(),
  }
  const transcript = await prisma.mediaTranscript.upsert({
    where: { assetId },
    create: { assetId, ...transcriptData },
    update: transcriptData,
    select: { id: true, updatedAt: true },
  })

  const saveTranslation = async (language, segments, fullText) => {
    const data = {
      status: "READY",
      provider: "seed",
      model: "fixture",
      fullText,
      segments,
      error: null,
      // Current as of this transcript, so the panel does not mark it outdated.
      sourceUpdatedAt: transcript.updatedAt,
      generatedAt: new Date(),
    }
    await prisma.mediaTranslation.upsert({
      where: { transcriptId_language: { transcriptId: transcript.id, language } },
      create: { transcriptId: transcript.id, language, ...data },
      update: data,
    })
  }

  await saveTranslation(
    E2E_TRANSLATION_LANGUAGE,
    E2E_TRANSLATION_SEGMENTS,
    E2E_TRANSLATION_SEGMENTS.map((s) => s.text).join("\n"),
  )
  await saveTranslation(
    E2E_SECOND_TRANSLATION_LANGUAGE,
    E2E_TRANSCRIPT_SEGMENTS.map((segment, i) => ({
      ...segment,
      text: `هذا هو السطر ${i + 1}`,
    })),
    "شكرا",
  )

  return {
    languages: [E2E_TRANSLATION_LANGUAGE, E2E_SECOND_TRANSLATION_LANGUAGE],
  }
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
async function seedFixtureAsset(prisma, ownerId, storageRoot, spec) {
  if (!existsSync(spec.source)) {
    throw new Error(
      `missing fixture ${spec.source}. It is committed to the repository; ` +
        "a clean checkout should have it.",
    )
  }

  const bytes = readFileSync(spec.source)
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex")
  const sizeBytes = statSync(spec.source).size
  const objectKey = fixtureObjectKey(checksumSha256, spec.extension)
  const physicalPath = path.join(storageRoot, objectKey)

  // The bytes, under the dev storage root the API will read them from.
  if (!existsSync(physicalPath)) {
    mkdirSync(path.dirname(physicalPath), { recursive: true })
    copyFileSync(spec.source, physicalPath)
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
        id: spec.storageObjectId,
        storageLocationId: storageLocation.id,
        objectKey,
        physicalPath,
        sizeBytes: BigInt(sizeBytes),
        checksumSha256,
        mimeType: spec.metadata.mimeType,
      },
    }))

  const assetData = {
    libraryId: libraries[spec.librarySlug].id,
    folderId: null,
    storageObjectId: storageObject.id,
    ownerId,
    filename: spec.filename,
    originalFilename: spec.filename,
    mimeType: spec.metadata.mimeType,
    mediaType: spec.mediaType,
    extension: spec.extension.replace(/^\./, ""),
    sizeBytes: BigInt(sizeBytes),
    checksumSha256,
    durationSeconds: spec.metadata.durationSeconds ?? null,
    width: spec.metadata.width ?? null,
    height: spec.metadata.height ?? null,
    codec: spec.metadata.codec ?? null,
    status: "READY",
    deletedAt: null,
  }

  await prisma.asset.upsert({
    where: { id: spec.assetId },
    create: { id: spec.assetId, ...assetData },
    // Re-point rather than duplicate, so replacing the fixture file works.
    update: assetData,
  })

  return { assetId: spec.assetId, objectKey, physicalPath, sizeBytes }
}

/** Both committed fixtures, seeded the same way. */
async function seedVideoFixture(prisma, ownerId, storageRoot) {
  const video = await seedFixtureAsset(prisma, ownerId, storageRoot, {
    assetId: E2E_VIDEO_ASSET_ID,
    storageObjectId: E2E_VIDEO_STORAGE_OBJECT_ID,
    filename: E2E_VIDEO_FILENAME,
    source: E2E_VIDEO_SOURCE,
    extension: ".mp4",
    mediaType: "VIDEO",
    librarySlug: "videos",
    metadata: E2E_VIDEO_METADATA,
  })
  await seedFixtureAsset(prisma, ownerId, storageRoot, {
    assetId: E2E_QUIET_VIDEO_ASSET_ID,
    storageObjectId: "e2e-quiet-video-fixture-object",
    filename: "dev-video-promo.mp4",
    source: E2E_VIDEO_SOURCE,
    extension: ".mp4",
    mediaType: "VIDEO",
    librarySlug: "videos",
    metadata: E2E_VIDEO_METADATA,
  })
  await seedFixtureAsset(prisma, ownerId, storageRoot, {
    assetId: E2E_IMAGE_ASSET_ID,
    storageObjectId: "e2e-image-fixture-object",
    filename: E2E_IMAGE_FILENAME,
    source: E2E_IMAGE_SOURCE,
    extension: ".png",
    mediaType: "IMAGE",
    librarySlug: "images",
    metadata: E2E_IMAGE_METADATA,
  })
  await seedFixtureAsset(prisma, ownerId, storageRoot, {
    assetId: E2E_DOC_ASSET_ID,
    storageObjectId: "e2e-doc-fixture-object",
    filename: E2E_DOC_FILENAME,
    source: E2E_DOC_SOURCE,
    extension: ".pdf",
    mediaType: "DOCUMENT",
    librarySlug: "documents",
    metadata: E2E_DOC_METADATA,
  })
  return video
}

/**
 * The suite writes to this database. Pointing it at production would seed a
 * fake owner into a real instance, so this is a hard stop rather than a warning.
 *
 * The rule is "a database marked as dev or test", not one specific name. It was
 * pinned to `arciin_dev` exactly, which meant the whole browser suite could only
 * ever run against that one database — so certifying a release from an isolated
 * worktree was impossible without pointing it at the same database a second
 * checkout was actively using. That is the contention the isolation exists to
 * remove. This now matches the policy tests/e2e/guard.ts already enforces, and
 * still refuses production by name.
 */
const PRODUCTION_DATABASE_NAME = "arciin"

/**
 * Mint the same local mock licence token `activateMockLicense` produces.
 *
 * Seeding `licensePlan: "pro"` alone does not survive a single request. The API
 * re-evaluates the licence from `licenseSignedToken`; an absent *or malformed*
 * token makes it write Free back over these columns and null the token
 * (license-service.ts), after which every Pro-gated route answers 403 — the AI
 * drawer, the transcript panel, chat conversations, all of it.
 *
 * That went unnoticed because the long-lived arciin_dev database already held a
 * valid token from a hand-run activation, so the browser suite only ever passed
 * against a database nobody could recreate. Signing a real one here is what
 * makes the suite reproducible from an empty database — which is what
 * certifying a release from an isolated worktree requires.
 *
 * Signed with SESSION_SECRET exactly as the app does, and marked `mock_dev`, so
 * it is valid for this instance only and obviously not a production licence.
 */
function signMockLicenceToken(instanceId, plan, activatedAt, expiresAt) {
  const payload = {
    v: 1,
    instanceId,
    plan,
    activatedAt: activatedAt.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    graceUntil: null,
    keyPrefix: "ARCIIN-DEV",
    source: "mock_dev",
  }
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const secret = process.env.SESSION_SECRET || "arciin-dev-license-secret"
  const sig = createHmac("sha256", secret).update(body).digest("base64url")
  return `arclic.v1.${body}.${sig}`
}

function assertDevDatabase(url) {
  if (!url) throw new Error("DATABASE_URL is not set")
  const name = new URL(url).pathname.replace(/^\//, "")
  if (name === PRODUCTION_DATABASE_NAME) {
    throw new Error(`refusing to seed: DATABASE_URL points at the production database "${name}".`)
  }
  if (!/test|dev/.test(name)) {
    throw new Error(
      `refusing to seed: DATABASE_URL database "${name}" is not marked as a test or dev ` +
        "database. Run with .env.development loaded, or name the database with a dev/test marker.",
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

    // Team includes every Pro feature plus `team.multi_user`. The entitlement
    // suite stubs `/api/license/status`, so it does not depend on this column.
    // Settings → Users cannot be browser-certified on Pro alone.
    const requestedPlan = process.argv.includes("--plan=free") ? "free" : "team"
    const licence = {
      licensePlan: requestedPlan,
      licenseStatus: requestedPlan === "free" ? "none" : "active",
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

    // The token binds to the instance id, so it can only be signed once the row
    // exists. Without this the licence above survives exactly until the first
    // request re-evaluates it.
    await prisma.instanceConfig.update({
      where: { id: instance.id },
      data: {
        licenseSignedToken: signMockLicenceToken(
          instance.id,
          requestedPlan,
          licence.licenseActivatedAt,
          licence.licenseExpiresAt,
        ),
        licenseKeyPrefix: "ARCIIN-DEV",
      },
    })

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

    const roleUsers = {}
    for (const spec of [
      { email: E2E_ADMIN_EMAIL, name: "E2E Admin", role: "ADMIN" },
      { email: E2E_MEMBER_EMAIL, name: "E2E Member", role: "MEMBER" },
      { email: E2E_VIEWER_EMAIL, name: "E2E Viewer", role: "VIEWER" },
    ]) {
      const rolePassword = randomBytes(24).toString("base64url")
      const roleHash = await hash(rolePassword)
      await prisma.user.upsert({
        where: { email: spec.email },
        create: {
          email: spec.email,
          name: spec.name,
          passwordHash: roleHash,
          role: spec.role,
          status: "ACTIVE",
        },
        update: { passwordHash: roleHash, status: "ACTIVE", role: spec.role },
      })
      roleUsers[spec.role.toLowerCase()] = { email: spec.email, password: rolePassword }
    }
    writeFileSync(E2E_ROLE_PASSWORD_FILE, JSON.stringify(roleUsers), { mode: 0o600 })
    chmodSync(E2E_ROLE_PASSWORD_FILE, 0o600)

    const storageRoot =
      process.env.ARCIIN_DATA_DIR ?? instance.storageRoot ?? "/srv/arce-projects/arciin-dev-storage"
    const video = await seedVideoFixture(prisma, user.id, storageRoot)
    const transcript = await seedTranscriptFixture(prisma, video.assetId)

    return { databaseName, email: user.email, instanceId: instance.id, video, transcript }
  } finally {
    await prisma.$disconnect()
  }
}

export async function setE2EPlan(plan) {
  if (plan !== "free" && plan !== "team" && plan !== "pro") {
    throw new Error(`unsupported e2e plan: ${plan}`)
  }
  assertDevDatabase(process.env.DATABASE_URL)
  const prisma = new PrismaClient()
  try {
    const instance = await prisma.instanceConfig.findFirst()
    if (!instance) throw new Error("no InstanceConfig to update")
    const activatedAt = new Date()
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    await prisma.instanceConfig.update({
      where: { id: instance.id },
      data: {
        licensePlan: plan,
        licenseStatus: plan === "free" ? "none" : "active",
        licenseSource: "mock_dev",
        licenseActivatedAt: activatedAt,
        licenseExpiresAt: expiresAt,
        licenseSignedToken: signMockLicenceToken(instance.id, plan, activatedAt, expiresAt),
        licenseKeyPrefix: "ARCIIN-DEV",
      },
    })
    return { instanceId: instance.id, plan }
  } finally {
    await prisma.$disconnect()
  }
}

// Allow `node scripts/e2e-seed.mjs` as well as import from globalSetup.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const setPlanArg = process.argv.find((arg) => arg.startsWith("--set-plan="))
  const work = setPlanArg
    ? setE2EPlan(setPlanArg.slice("--set-plan=".length)).then((result) => {
        console.log(`e2e plan set to ${result.plan}`)
      })
    : seedE2EUser().then((result) => {
        console.log(
          `seeded ${result.email} in ${result.databaseName}; password written to ${E2E_PASSWORD_FILE}`,
        )
        console.log(
          `video fixture ${result.video.assetId} ready (${Math.round(result.video.sizeBytes / 1024)} KB)`,
        )
        console.log(`translations seeded: ${result.transcript.languages.join(", ")}`)
      })
  work.catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
