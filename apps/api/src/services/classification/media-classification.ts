import path from "node:path"

import { execa } from "execa"
import { fileTypeFromFile } from "file-type"
import sharp from "sharp"

import { getFileExtension, inferMediaType } from "@arciin/shared"

type MediaAnalysis = {
  mimeType: string
  extension: string
  mediaType: "VIDEO" | "IMAGE" | "AUDIO" | "DOCUMENT" | "ARCHIVE" | "OTHER"
  durationSeconds?: number
  width?: number
  height?: number
  codec?: string
}

async function readWithFfprobe(filePath: string) {
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

    return JSON.parse(stdout) as {
      streams?: Array<Record<string, unknown>>
      format?: Record<string, unknown>
    }
  } catch {
    return null
  }
}

export async function analyzeStoredFile(
  filePath: string,
  originalFilename: string,
  fallbackMimeType?: string | null
): Promise<MediaAnalysis> {
  const detected = await fileTypeFromFile(filePath)
  const mimeType = detected?.mime || fallbackMimeType || "application/octet-stream"
  const extension = (detected?.ext || getFileExtension(originalFilename) || path.extname(filePath).replace(".", "")).toLowerCase()
  const mediaType = inferMediaType(mimeType, originalFilename)

  const base: MediaAnalysis = {
    mimeType,
    extension,
    mediaType,
  }

  if (mediaType === "IMAGE") {
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

  if (mediaType === "VIDEO" || mediaType === "AUDIO") {
    const ffprobe = await readWithFfprobe(filePath)
    const stream = ffprobe?.streams?.find((item) =>
      mediaType === "VIDEO"
        ? item.codec_type === "video"
        : item.codec_type === "audio"
    )
    const format = ffprobe?.format

    return {
      ...base,
      durationSeconds:
        typeof format?.duration === "string" ? Number(format.duration) : undefined,
      width: typeof stream?.width === "number" ? stream.width : undefined,
      height: typeof stream?.height === "number" ? stream.height : undefined,
      codec: typeof stream?.codec_name === "string" ? stream.codec_name : undefined,
    }
  }

  return base
}
