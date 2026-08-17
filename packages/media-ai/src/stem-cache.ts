import { createHash } from "node:crypto"
import { access, copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import type { AudioStems } from "./audio-separation"

/**
 * Keeping separated stems, so a retry does not repeat the expensive half.
 *
 * Separation is deterministic and slow: the same audio through the same model
 * always yields the same stems, and on this hardware that takes two and a half
 * hours for a twelve-minute video. Synthesis afterwards is quick and comparatively
 * flaky — a provider hiccup, a rate limit, a bad segment.
 *
 * Until now a flaky failure in the cheap stage discarded a successful expensive
 * one: the work directory was removed in `finally`, so retrying a dub that died
 * at "segment 1 of 12" meant separating the whole file again. That is the wrong
 * thing to throw away.
 *
 * The key is the audio and the model, and nothing else. Not the language, not
 * the voice settings, not the translation — none of those change what the stems
 * are. So an Arabic dub and a Spanish dub of the same video share one
 * separation, which is the same saving again.
 */

/**
 * Everything that changes what a separation produces.
 *
 * The hard part is what to leave out. Language must not be here — an Arabic and
 * a Spanish dub of one video want the same stems, and including the target
 * would defeat the whole point. Nor may the voice, the accent, the TTS model or
 * the GPU: none of them touch the separation. Nor even *where* it ran, because
 * the same implementation at the same version on the same audio produces the
 * same result whether that was this server's CPU or a rented GPU — and refusing
 * to share across that boundary would mean paying a provider for work already
 * sitting on disk.
 *
 * What must be here is anything that would make two outputs semantically
 * different: the audio, the implementation, its version, the model, and any
 * setting that alters inference. Getting this wrong in the permissive direction
 * is the dangerous one — a stale hit serves stems from a different model and
 * nobody notices until they listen.
 */
export type SeparationFingerprint = {
  /** SHA-256 of the source audio. */
  sourceHash: string
  /** "python-audio-separator", or whatever else produced these. */
  implementation: string
  /** Its version, because a separator upgrade can change output. */
  version: string
  /** "htdemucs.yaml". */
  model: string
  /** How four stems became two, and anything else that alters inference. */
  settings?: Record<string, string | number | boolean | undefined>
}

/** What a hit contains. Two files, not four. */
export const DIALOGUE_FILE = "dialogue.wav"
export const BACKGROUND_FILE = "background.wav"
const META_FILE = "meta.json"

/**
 * Demucs emits vocals, drums, bass and other, and the pipeline immediately sums
 * the last three into one background track. Caching the raw four would double
 * the disk for something no consumer wants.
 */
export type StemCacheMeta = SeparationFingerprint & {
  createdAt: string
  /** Only ever "separated": see `putStems`. */
  strategy: string
}

/**
 * Roughly 500 MB per twelve-minute video, so this is not free.
 *
 * A week is long enough to cover a retry, a second language, and someone coming
 * back to a job the next working day — and short enough that a self-hosted box
 * does not silently fill up with stems for videos nobody is dubbing any more.
 */
export const DEFAULT_STEM_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * A stable digest of everything that matters.
 *
 * Hashed rather than concatenated so the directory name stays a fixed length
 * whatever the settings contain, and so adding a field later cannot produce a
 * key that collides with an old one. Settings are sorted, because an object's
 * key order is not part of its meaning and two identical configurations must
 * not miss each other over it.
 */
export function stemCacheKey(fingerprint: SeparationFingerprint): string {
  const settings = Object.entries(fingerprint.settings ?? {})
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(",")

  const material = [
    fingerprint.sourceHash,
    fingerprint.implementation,
    fingerprint.version,
    fingerprint.model,
    settings,
  ].join("|")

  const digest = createHash("sha256").update(material).digest("hex").slice(0, 32)

  // The model stays legible in the path: someone clearing disk space should be
  // able to see what a directory holds without reading a manifest.
  const readableModel = fingerprint.model
    .replace(/[^\w.-]+/g, "_")
    .replace(/\.(yaml|onnx|ckpt|th)$/i, "")
  return `${readableModel}-${digest}`
}

export function stemCacheDir(storageRoot: string, fingerprint: SeparationFingerprint): string {
  return path.join(storageRoot, "cache", "stems", stemCacheKey(fingerprint))
}

/**
 * A previous separation of this audio, if there is a complete one.
 *
 * Both files must be present and non-empty. A half-written cache is worse than
 * no cache: it would be mixed into a dub silently, and the result would be a
 * track that is quietly missing its music.
 */
export async function getStems(
  storageRoot: string,
  fingerprint: SeparationFingerprint,
): Promise<AudioStems | null> {
  const dir = stemCacheDir(storageRoot, fingerprint)
  const dialoguePath = path.join(dir, DIALOGUE_FILE)
  const backgroundPath = path.join(dir, BACKGROUND_FILE)

  try {
    const [dialogue, background] = await Promise.all([stat(dialoguePath), stat(backgroundPath)])
    if (dialogue.size === 0 || background.size === 0) return null
  } catch {
    return null
  }

  return { dialoguePath, backgroundPath, strategy: "separated" }
}

/**
 * Store a separation's output for next time.
 *
 * Written beside the destination and renamed into place, because a crash
 * part-way through a copy would otherwise leave exactly the truncated stem that
 * `getStems` is trying to avoid trusting. Rename within one filesystem is
 * atomic; a reader sees the directory either complete or absent.
 *
 * Refuses anything that was not really separated: a "replaced" result is the
 * original audio with the dialogue gone, and reusing that as though it were a
 * separation would destroy the music on every later dub of the same video.
 */
export async function putStems(
  storageRoot: string,
  fingerprint: SeparationFingerprint,
  stems: AudioStems,
): Promise<AudioStems | null> {
  if (stems.strategy !== "separated") return null

  const finalDir = stemCacheDir(storageRoot, fingerprint)
  const stagingDir = `${finalDir}.incoming-${process.pid}-${Date.now()}`

  try {
    // Already there — another job for the same audio got here first.
    await access(finalDir)
    return await getStems(storageRoot, fingerprint)
  } catch {
    // Not cached yet, which is the normal path.
  }

  try {
    await mkdir(stagingDir, { recursive: true })
    await copyFile(stems.dialoguePath, path.join(stagingDir, DIALOGUE_FILE))
    await copyFile(stems.backgroundPath, path.join(stagingDir, BACKGROUND_FILE))

    const meta: StemCacheMeta = {
      ...fingerprint,
      createdAt: new Date().toISOString(),
      strategy: stems.strategy,
    }
    await writeFile(path.join(stagingDir, META_FILE), JSON.stringify(meta, null, 2), "utf8")

    await mkdir(path.dirname(finalDir), { recursive: true })
    await rename(stagingDir, finalDir)
    return await getStems(storageRoot, fingerprint)
  } catch {
    // Losing the cache must never lose the dub: the caller already has usable
    // stems in its work directory and can carry on without this.
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    return null
  }
}

export type StemCacheSweep = {
  examined: number
  deleted: number
  retained: number
  bytesRecovered: number
}

/**
 * Delete cached stems older than the retention window.
 *
 * Age is taken from the directory rather than from its contents, and abandoned
 * `.incoming-` staging directories are swept too — a worker killed mid-copy
 * leaves one behind, and they are as large as the real thing.
 */
export async function sweepStemCache(
  storageRoot: string,
  retentionMs = DEFAULT_STEM_RETENTION_MS,
  now = Date.now(),
): Promise<StemCacheSweep> {
  const root = path.join(storageRoot, "cache", "stems")
  const result: StemCacheSweep = { examined: 0, deleted: 0, retained: 0, bytesRecovered: 0 }

  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return result
  }

  for (const entry of entries) {
    const dir = path.join(root, entry)
    let info
    try {
      info = await stat(dir)
    } catch {
      continue
    }
    if (!info.isDirectory()) continue

    result.examined += 1
    const age = now - info.mtimeMs
    // Staging leftovers are junk at any age beyond a few minutes.
    const stale = entry.includes(".incoming-") ? age > 30 * 60 * 1000 : age > retentionMs
    if (!stale) {
      result.retained += 1
      continue
    }

    let bytes = 0
    try {
      for (const file of await readdir(dir)) {
        const fileInfo = await stat(path.join(dir, file)).catch(() => null)
        if (fileInfo?.isFile()) bytes += fileInfo.size
      }
    } catch {
      // Size is for reporting only; a failure here must not stop the delete.
    }

    await rm(dir, { recursive: true, force: true }).catch(() => {})
    result.deleted += 1
    result.bytesRecovered += bytes
  }

  return result
}
