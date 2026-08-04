import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"

import type { FastifyReply } from "fastify"

type StreamFileOptions = {
  path: string
  contentType: string
  contentDisposition?: string | null
  rangeHeader?: string | null
}

function parseByteRange(
  rangeHeader: string,
  fileSize: number,
): { start: number; end: number } | null {
  const match = /^bytes=(.*)$/i.exec(rangeHeader.trim())
  if (!match) return null

  const [startPart, endPart] = match[1]!.split("-", 2)
  if (endPart === undefined) return null

  let start: number
  let end: number

  if (startPart === "") {
    const suffix = parseInt(endPart, 10)
    if (Number.isNaN(suffix) || suffix <= 0) return null
    start = Math.max(fileSize - suffix, 0)
    end = fileSize - 1
  } else {
    start = parseInt(startPart, 10)
    if (Number.isNaN(start)) return null
    end = endPart ? parseInt(endPart, 10) : fileSize - 1
    if (endPart && Number.isNaN(end)) return null
  }

  if (start < 0 || end < start || start >= fileSize) return null
  end = Math.min(end, fileSize - 1)
  return { start, end }
}

/** Stream a file with HTTP Range support (required for iOS `<video>` / `<audio>` seeking). */
export async function streamFileResponse(
  reply: FastifyReply,
  options: StreamFileOptions,
) {
  const { path: filePath, contentType, contentDisposition, rangeHeader } = options
  const stats = await stat(filePath)
  const fileSize = stats.size

  reply.header("Accept-Ranges", "bytes")
  reply.header("content-type", contentType)
  // Private browser/HTTP cache — helps mobile reopen within a session without
  // re-downloading every byte. ETag invalidates when the file changes on disk.
  const etag = `"${Math.trunc(stats.mtimeMs)}-${fileSize}"`
  reply.header("ETag", etag)
  reply.header("Cache-Control", "private, max-age=86400")
  if (contentDisposition) {
    reply.header("content-disposition", contentDisposition)
  }

  if (!rangeHeader) {
    reply.header("Content-Length", fileSize)
    return reply.send(createReadStream(filePath))
  }

  const range = parseByteRange(rangeHeader, fileSize)
  if (!range) {
    reply.status(416)
    reply.header("Content-Range", `bytes */${fileSize}`)
    return reply.send()
  }

  const { start, end } = range
  const chunkSize = end - start + 1

  reply.status(206)
  reply.header("Content-Range", `bytes ${start}-${end}/${fileSize}`)
  reply.header("Content-Length", chunkSize)
  return reply.send(createReadStream(filePath, { start, end }))
}
