import type { SocketEventPayload } from "@/lib/types/events"

export type UploadCompleteOrigin = "upload" | "url"
export type UploadClientChannel = "web" | "mobile"

function extractFileName(message: string): string | undefined {
  const patterns = [
    /^(.+?)\s+is ready\.?$/i,
    /^(.+?)\s+uploaded successfully\.?$/i,
    /^(.+?)\s+imported successfully\.?$/i,
    /^(.+?)\s+imported from link\.?$/i,
    /^(.+?)\s+uploaded\.?$/i,
  ]
  for (const pattern of patterns) {
    const match = message.match(pattern)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
}

function readOrigin(data: Record<string, unknown>): UploadCompleteOrigin {
  if (data.origin === "url" || data.source === "url") return "url"
  return "upload"
}

function readClientChannel(data: Record<string, unknown>): UploadClientChannel {
  return data.client === "mobile" ? "mobile" : "web"
}

export function parseUploadCompletePayload(
  payload: Pick<SocketEventPayload, "message" | "data">,
) {
  const data = payload.data ?? {}
  const origin = readOrigin(data)
  const client = readClientChannel(data)
  let fileName = typeof data.fileName === "string" ? data.fileName.trim() : ""
  if (!fileName && payload.message) {
    fileName = extractFileName(payload.message) ?? ""
  }
  const destination =
    typeof data.destination === "string" ? data.destination : undefined

  return {
    origin,
    client,
    fileName: fileName || undefined,
    destination,
  }
}

export function parseUploadFailedPayload(
  payload: Pick<SocketEventPayload, "message" | "data">,
) {
  const data = payload.data ?? {}
  const origin = readOrigin(data)
  const fileName =
    typeof data.fileName === "string" ? data.fileName.trim() : undefined

  return {
    origin,
    fileName: fileName || undefined,
    message: payload.message,
  }
}
