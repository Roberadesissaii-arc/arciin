/**
 * Audit (and, only when explicitly asked, repair) library-placement defects
 * left behind by the bugs fixed in Repair Batch 1.
 *
 *   pnpm tsx scripts/audit-and-repair-library-placement.ts --dry-run
 *   pnpm tsx scripts/audit-and-repair-library-placement.ts --apply --issue UP-002
 *   pnpm tsx scripts/audit-and-repair-library-placement.ts --apply --asset <id>
 *
 * Dry-run is the default and the only mode that runs without an explicit
 * selection: `--apply` requires `--issue` or `--asset`, so a bare `--apply`
 * can never rewrite everything at once.
 *
 * Guarantees:
 *   - never deletes a physical file;
 *   - never touches an asset whose correct destination is ambiguous;
 *   - confirms every audio-only reclassification with ffprobe before proposing
 *     it, rather than trusting the stored MIME that caused the bug;
 *   - reports ids and counts, not filenames.
 */
import { execFile } from "node:child_process"
import { access, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { config as loadEnv } from "dotenv"

import { PrismaClient } from "@prisma/client"
import {
  isIsoMediaContainerMime,
  refineIsoMediaClassification,
  summarizeMediaStreams,
} from "@arciin/shared"

loadEnv()

const prisma = new PrismaClient()

const ISSUES = {
  "UP-002": "Audio-only assets classified as VIDEO",
  "UP-008-deleted": "Assets inside soft-deleted folders",
  "UP-008-foreign": "Assets whose folder belongs to a different library",
  "UP-MISROUTED": "Assets whose media type contradicts their library",
  "UP-001": "Upload sessions stranded at CLASSIFIED",
} as const

type IssueId = keyof typeof ISSUES

type Finding = {
  issue: IssueId
  recordId: string
  detail: string
  proposal: string
  /**
   * Field values as they are *now*. Written to a rollback snapshot before any
   * change is applied, so every repair can be reversed field-by-field without
   * needing a full database dump.
   */
  before?: Record<string, unknown>
  /** Absent when the correct destination is ambiguous — never auto-applied. */
  apply?: () => Promise<void>
}

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply")
  const issueIndex = argv.indexOf("--issue")
  const assetIndex = argv.indexOf("--asset")

  return {
    apply,
    dryRun: !apply,
    issue: issueIndex >= 0 ? (argv[issueIndex + 1] as IssueId | undefined) : undefined,
    assetId: assetIndex >= 0 ? argv[assetIndex + 1] : undefined,
  }
}

const LIBRARY_KIND_FOR_MEDIA_TYPE: Record<string, string> = {
  VIDEO: "VIDEO",
  IMAGE: "IMAGE",
  AUDIO: "AUDIO",
  DOCUMENT: "DOCUMENT",
  APPLICATION: "INBOX",
  CODE: "INBOX",
  ARCHIVE: "INBOX",
  OTHER: "INBOX",
}

/** `node:child_process` rather than execa: this script runs standalone under tsx. */
const run = promisify(execFile)

async function ffprobeStreams(filePath: string) {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      filePath,
    ])
    const parsed = JSON.parse(stdout) as {
      streams?: Array<Record<string, unknown>>
    }
    return summarizeMediaStreams(parsed.streams)
  } catch {
    return null
  }
}

/** UP-002 — VIDEO assets whose bytes are actually audio-only. */
async function findAudioOnlyVideos(libraries: Array<{ id: string; kind: string }>) {
  const findings: Finding[] = []

  const candidates = await prisma.asset.findMany({
    where: { deletedAt: null, mediaType: "VIDEO" },
    include: { storageObject: { select: { physicalPath: true } } },
  })

  const musicLibrary = libraries.find((library) => library.kind === "AUDIO")

  for (const asset of candidates) {
    if (!isIsoMediaContainerMime(asset.mimeType)) continue

    const filePath = asset.storageObject.physicalPath
    try {
      await access(filePath)
    } catch {
      findings.push({
        issue: "UP-002",
        recordId: asset.id,
        detail: `mime=${asset.mimeType} ext=${asset.extension} — file missing on disk`,
        proposal: "SKIP — cannot confirm with ffprobe (file unreadable)",
      })
      continue
    }

    const streams = await ffprobeStreams(filePath)
    if (!streams) {
      findings.push({
        issue: "UP-002",
        recordId: asset.id,
        detail: `mime=${asset.mimeType} ext=${asset.extension} — ffprobe failed`,
        proposal: "SKIP — cannot confirm with ffprobe",
      })
      continue
    }

    if (streams.hasVideoStream || !streams.hasAudioStream) continue

    const refined = refineIsoMediaClassification({
      mediaType: asset.mediaType,
      mimeType: asset.mimeType,
      extension: asset.extension,
      originalFilename: asset.originalFilename,
      streams,
    })

    if (refined.mediaType !== "AUDIO") continue

    if (!musicLibrary) {
      findings.push({
        issue: "UP-002",
        recordId: asset.id,
        detail: "ffprobe: audio-only",
        proposal: "SKIP — no AUDIO library exists to move it into",
      })
      continue
    }

    const alreadyInMusic = asset.libraryId === musicLibrary.id
    const movesLibrary = !alreadyInMusic && asset.folderId === null

    findings.push({
      issue: "UP-002",
      recordId: asset.id,
      detail: `ffprobe: audio-only (0 video streams) — currently mediaType=VIDEO mime=${asset.mimeType} ext=${asset.extension}`,
      before: {
        table: "Asset",
        id: asset.id,
        mediaType: asset.mediaType,
        mimeType: asset.mimeType,
        extension: asset.extension,
        libraryId: asset.libraryId,
        folderId: asset.folderId,
      },
      proposal: movesLibrary
        ? `mediaType VIDEO→AUDIO, mime→${refined.mimeType}, ext→${refined.extension}, library→Music`
        : `mediaType VIDEO→AUDIO, mime→${refined.mimeType}, ext→${refined.extension}` +
          (asset.folderId
            ? " (stays in its folder — the user filed it there deliberately)"
            : " (already in Music)"),
      apply: async () => {
        await prisma.asset.update({
          where: { id: asset.id },
          data: {
            mediaType: "AUDIO",
            mimeType: refined.mimeType,
            extension: refined.extension,
            // Only relocate assets sitting at a library root. An asset inside a
            // folder was placed there on purpose; moving it would be a guess.
            ...(movesLibrary ? { libraryId: musicLibrary.id } : {}),
          },
        })
      },
    })
  }

  return findings
}

/** UP-008 — assets stranded inside soft-deleted folders. */
async function findAssetsInDeletedFolders() {
  const assets = await prisma.asset.findMany({
    where: { deletedAt: null, folder: { is: { deletedAt: { not: null } } } },
    select: { id: true, folderId: true, libraryId: true },
  })

  return assets.map<Finding>((asset) => ({
    issue: "UP-008-deleted",
    recordId: asset.id,
    detail: `folderId=${asset.folderId} is soft-deleted — asset is unreachable in the UI`,
    proposal:
      "AMBIGUOUS — move to library root, restore the folder, or soft-delete the asset. Needs a human decision.",
  }))
}

/** UP-008 — folder/library relationships that disagree. */
async function findCrossLibraryFolders() {
  const assets = await prisma.asset.findMany({
    where: { deletedAt: null, folderId: { not: null } },
    select: {
      id: true,
      libraryId: true,
      folderId: true,
      folder: { select: { libraryId: true } },
    },
  })

  return assets
    .filter((asset) => asset.folder && asset.folder.libraryId !== asset.libraryId)
    .map<Finding>((asset) => ({
      issue: "UP-008-foreign",
      recordId: asset.id,
      detail: `asset.libraryId=${asset.libraryId} but folder.libraryId=${asset.folder!.libraryId}`,
      proposal: `Realign asset.libraryId to the folder's library (${asset.folder!.libraryId})`,
      before: { table: "Asset", id: asset.id, libraryId: asset.libraryId },
      apply: async () => {
        await prisma.asset.update({
          where: { id: asset.id },
          data: { libraryId: asset.folder!.libraryId },
        })
      },
    }))
}

/** Assets whose media type contradicts the library they sit in. */
async function findMisroutedAssets(libraries: Array<{ id: string; kind: string; name: string }>) {
  const byId = new Map(libraries.map((library) => [library.id, library]))

  const assets = await prisma.asset.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      libraryId: true,
      folderId: true,
      mediaType: true,
    },
  })

  return assets
    .filter((asset) => {
      const library = byId.get(asset.libraryId)
      if (!library) return false
      const expected = LIBRARY_KIND_FOR_MEDIA_TYPE[asset.mediaType]
      return expected !== undefined && expected !== library.kind
    })
    .map<Finding>((asset) => {
      const library = byId.get(asset.libraryId)!
      return {
        issue: "UP-MISROUTED",
        recordId: asset.id,
        detail: `mediaType=${asset.mediaType} but library kind=${library.kind}${
          asset.folderId ? " (inside a folder)" : " (at library root)"
        }`,
        proposal:
          "AMBIGUOUS — may be a deliberate user placement. Review before moving; not auto-applied.",
      }
    })
}

/**
 * UP-001 — sessions stranded at CLASSIFIED by the old completion guard.
 *
 * Only sessions whose work demonstrably finished are eligible: the asset must
 * still exist, not be FAILED, have its file on disk, and have no job still
 * queued, active, or failed. Anything else is reported but left alone, because
 * marking a genuinely unfinished upload READY would hide a real failure.
 */
async function findStuckUploadSessions() {
  const sessions = await prisma.uploadSession.findMany({
    where: { status: "CLASSIFIED" },
    select: {
      id: true,
      assetId: true,
      detectedMediaType: true,
      createdAt: true,
      status: true,
      progress: true,
      completedAt: true,
      asset: {
        select: {
          id: true,
          status: true,
          storageObject: { select: { physicalPath: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  })

  // One query for every unfinished job, rather than one per session.
  const unfinishedJobs = await prisma.job.findMany({
    where: { status: { in: ["QUEUED", "ACTIVE", "FAILED"] } },
    select: { payload: true },
  })
  const blockedAssetIds = new Set<string>()
  for (const job of unfinishedJobs) {
    const payload = job.payload as { assetId?: string } | null
    if (payload?.assetId) blockedAssetIds.add(payload.assetId)
  }

  const eligibility = new Map<string, string | null>()
  for (const session of sessions) {
    if (!session.assetId || !session.asset) {
      eligibility.set(session.id, "no asset attached")
      continue
    }
    if (session.asset.status === "FAILED") {
      eligibility.set(session.id, "asset is FAILED")
      continue
    }
    if (blockedAssetIds.has(session.asset.id)) {
      eligibility.set(session.id, "a job for this asset is still queued/active/failed")
      continue
    }
    try {
      await access(session.asset.storageObject.physicalPath)
      eligibility.set(session.id, null)
    } catch {
      eligibility.set(session.id, "physical file missing on disk")
    }
  }

  return sessions.map<Finding>((session) => ({
    issue: "UP-001",
    recordId: session.id,
    detail: `stranded at CLASSIFIED since ${session.createdAt.toISOString().slice(0, 10)} (detected=${session.detectedMediaType})`,
    before: {
      table: "UploadSession",
      id: session.id,
      status: session.status,
      progress: session.progress,
      completedAt: session.completedAt,
    },
    proposal: eligibility.get(session.id)
      ? `SKIP — ${eligibility.get(session.id)}`
      : "status CLASSIFIED→READY, progress→100, completedAt→createdAt (work already finished)",
    apply: eligibility.get(session.id)
      ? undefined
      : async () => {
          await prisma.uploadSession.update({
            where: { id: session.id },
            data: {
              status: "READY",
              progress: 100,
              // Backdate to when the upload happened rather than now: these are
              // historical rows, and stamping them "completed today" would
              // corrupt the uploads timeline.
              completedAt: session.createdAt,
            },
          })
        },
  }))
}

function printSection(issue: IssueId, findings: Finding[]) {
  const scoped = findings.filter((finding) => finding.issue === issue)
  console.log(`\n${"─".repeat(78)}`)
  console.log(`${issue} — ${ISSUES[issue]}`)
  console.log(`${"─".repeat(78)}`)
  console.log(`Affected records: ${scoped.length}`)

  if (scoped.length === 0) {
    console.log("  (none)")
    return
  }

  const applicable = scoped.filter((finding) => finding.apply).length
  console.log(`Auto-applicable:  ${applicable}`)
  console.log(`Needs review:     ${scoped.length - applicable}`)
  console.log("")

  for (const finding of scoped.slice(0, 50)) {
    console.log(`  ${finding.recordId}`)
    console.log(`    detail:   ${finding.detail}`)
    console.log(`    proposal: ${finding.proposal}`)
  }

  if (scoped.length > 50) {
    console.log(`  … and ${scoped.length - 50} more (not listed)`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.apply && !args.issue && !args.assetId) {
    console.error(
      "Refusing to run: --apply requires an explicit --issue <id> or --asset <assetId>.\n" +
        `Valid issues: ${Object.keys(ISSUES).join(", ")}`,
    )
    process.exitCode = 1
    return
  }

  if (args.issue && !(args.issue in ISSUES)) {
    console.error(`Unknown issue "${args.issue}". Valid: ${Object.keys(ISSUES).join(", ")}`)
    process.exitCode = 1
    return
  }

  const libraries = await prisma.library.findMany({
    select: { id: true, kind: true, name: true },
  })

  console.log("Arciin — library placement audit")
  console.log(`Mode: ${args.dryRun ? "DRY RUN (no writes)" : `APPLY (${args.issue ?? args.assetId})`}`)
  console.log(`Database: ${new URL(process.env.DATABASE_URL ?? "postgres://unset").pathname.slice(1)}`)
  console.log(`Libraries: ${libraries.length}`)

  const findings = [
    ...(await findAudioOnlyVideos(libraries)),
    ...(await findAssetsInDeletedFolders()),
    ...(await findCrossLibraryFolders()),
    ...(await findMisroutedAssets(libraries)),
    ...(await findStuckUploadSessions()),
  ]

  for (const issue of Object.keys(ISSUES) as IssueId[]) {
    printSection(issue, findings)
  }

  console.log(`\n${"═".repeat(78)}`)
  console.log(`TOTAL findings: ${findings.length}`)
  console.log(`${"═".repeat(78)}`)

  if (args.dryRun) {
    console.log("\nDry run — nothing was modified.")
    console.log("To repair one class of issue:")
    console.log("  pnpm tsx scripts/audit-and-repair-library-placement.ts --apply --issue UP-002")
    return
  }

  const selected = findings.filter((finding) => {
    if (args.assetId) return finding.recordId === args.assetId
    return finding.issue === args.issue
  })

  const applicable = selected.filter((finding) => finding.apply)
  const skipped = selected.length - applicable.length

  // Rollback snapshot first — nothing is written until the before-state is on
  // disk, so every applied change can be reversed field-by-field.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const snapshotPath = path.resolve(
    process.cwd(),
    "reports",
    `repair-snapshot-${args.issue ?? args.assetId}-${stamp}.json`,
  )
  await mkdir(path.dirname(snapshotPath), { recursive: true })
  await writeFile(
    snapshotPath,
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        selection: { issue: args.issue ?? null, assetId: args.assetId ?? null },
        recordCount: applicable.length,
        records: applicable.map((finding) => ({
          issue: finding.issue,
          recordId: finding.recordId,
          proposal: finding.proposal,
          before: finding.before ?? null,
        })),
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  console.log(`\nRollback snapshot written: ${snapshotPath}`)

  console.log(`Applying ${applicable.length} change(s); skipping ${skipped} ambiguous record(s).`)

  let applied = 0
  for (const finding of applicable) {
    try {
      await finding.apply!()
      applied += 1
      console.log(`  ✓ ${finding.recordId}`)
    } catch (error) {
      console.error(`  ✗ ${finding.recordId}: ${error instanceof Error ? error.message : error}`)
    }
  }

  console.log(`\nApplied ${applied} of ${applicable.length}. No files were deleted.`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
