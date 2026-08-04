import path from "node:path"

import { execa } from "execa"
import { fileTypeFromFile } from "file-type"
import sharp from "sharp"

import {
  getFileExtension,
  inferMediaType,
  isIsoMediaContainerMime,
  isOfficeContainerMime,
  refineIsoMediaClassification,
  refineOfficeClassification,
  summarizeMediaStreams,
} from "@arciin/shared"
import { readZipEntries } from "@arciin/storage"

/** Minimal logger shape so callers can pass `request.log` without coupling. */
type ClassificationLogger = {
  warn: (obj: Record<string, unknown>, msg: string) => void
}

type MediaAnalysis = {
  mimeType: string
  extension: string
  mediaType:
    | "VIDEO"
    | "IMAGE"
    | "AUDIO"
    | "DOCUMENT"
    | "ARCHIVE"
    | "APPLICATION"
    | "CODE"
    | "OTHER"
  durationSeconds?: number
  width?: number
  height?: number
  codec?: string
}

type FfprobeResult = {
  streams?: Array<Record<string, unknown>>
  format?: Record<string, unknown>
}

async function readWithFfprobe(
  filePath: string,
  logger?: ClassificationLogger,
): Promise<FfprobeResult | null> {
  try {
    const { stdout } = await execa("ffprobe", [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      filePath,
    ])

    return JSON.parse(stdout) as FfprobeResult
  } catch (err) {
    logger?.warn(
      { err, filePath },
      "ffprobe inspection failed — falling back to container-based classification",
    )
    return null
  }
}


function parseDurationSeconds(
  format: Record<string, unknown> | undefined,
  stream: Record<string, unknown> | undefined,
): number | undefined {
  const raw =
    (typeof format?.duration === "string" ? Number(format.duration) : undefined) ??
    (typeof stream?.duration === "string" ? Number(stream.duration) : undefined)

  if (raw == null || !Number.isFinite(raw) || raw <= 0) return undefined
  return raw
}

export async function analyzeStoredFile(
  filePath: string,
  originalFilename: string,
  fallbackMimeType?: string | null,
  logger?: ClassificationLogger,
): Promise<MediaAnalysis> {
  const detected = await fileTypeFromFile(filePath)
  const detectedMimeType = detected?.mime || fallbackMimeType || "application/octet-stream"
  const detectedExtension = (detected?.ext || getFileExtension(originalFilename) || path.extname(filePath).replace(".", "")).toLowerCase()
  const detectedMediaType = inferMediaType(detectedMimeType, originalFilename)

  // MP4/MOV/M4A containers carry audio-only, video-only, or both, and magic
  // bytes only reveal the container. Probe once and let the stream list decide,
  // otherwise an audio-only .m4a lands in Videos.
  let ffprobe: FfprobeResult | null = null
  let probed = false

  if (isIsoMediaContainerMime(detectedMimeType)) {
    ffprobe = await readWithFfprobe(filePath, logger)
    probed = true
  }

  const refined = refineIsoMediaClassification({
    mediaType: detectedMediaType,
    mimeType: detectedMimeType,
    extension: detectedExtension,
    originalFilename,
    streams: summarizeMediaStreams(ffprobe?.streams),
  })

  let base: MediaAnalysis = {
    mimeType: refined.mimeType,
    extension: refined.extension,
    mediaType: refined.mediaType,
  }

  // Office documents arrive as their container: file-type reports a .docx as
  // application/zip, which stored the wrong MIME and a "zip" extension. Read
  // the container's entry names to identify the real format — entry names come
  // from the file itself, so a renamed archive cannot fake them.
  if (isOfficeContainerMime(base.mimeType)) {
    const listing = await readZipEntries(filePath)
    const office = refineOfficeClassification({
      mimeType: base.mimeType,
      extension: base.extension,
      originalFilename,
      zipEntries: listing?.entries ?? null,
      openDocumentMimetype: listing?.openDocumentMimetype ?? null,
    })

    if (office.mismatch) {
      logger?.warn(
        { ...office.mismatch, filePath },
        "office document extension disagrees with its contents — trusting contents",
      )
    }

    if (office.changed) {
      base = {
        ...base,
        mimeType: office.mimeType,
        extension: office.extension,
        mediaType: inferMediaType(office.mimeType, originalFilename),
      }
    }
  }

  if (base.mediaType === "IMAGE") {
    try {
      const metadata = await sharp(filePath).metadata()
      return {
        ...base,
        width: metadata.width,
        height: metadata.height,
      }
    } catch {
      return base
    }
  }

  if (base.mediaType === "VIDEO" || base.mediaType === "AUDIO") {
    if (!probed) {
      ffprobe = await readWithFfprobe(filePath, logger)
    }

    const stream = ffprobe?.streams?.find((item) =>
      base.mediaType === "VIDEO"
        ? item.codec_type === "video"
        : item.codec_type === "audio"
    )
    const format = ffprobe?.format

    return {
      ...base,
      durationSeconds: parseDurationSeconds(format, stream),
      width: typeof stream?.width === "number" ? stream.width : undefined,
      height: typeof stream?.height === "number" ? stream.height : undefined,
      codec: typeof stream?.codec_name === "string" ? stream.codec_name : undefined,
    }
  }

  return base
}
