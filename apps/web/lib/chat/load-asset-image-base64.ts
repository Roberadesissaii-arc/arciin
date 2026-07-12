const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/** Load open preview image as base64 for Ollama vision (same origin, session cookie). */
export async function loadAssetImageBase64(assetId: string, updatedAt: string): Promise<string | null> {
  const url = `/api/assets/${assetId}/download?inline=1&v=${encodeURIComponent(updatedAt)}`
  const res = await fetch(url, { credentials: "include" })
  if (!res.ok) return null

  const len = Number(res.headers.get("content-length") || 0)
  if (len > MAX_IMAGE_BYTES) return null

  const blob = await res.blob()
  if (blob.size > MAX_IMAGE_BYTES) return null

  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}
