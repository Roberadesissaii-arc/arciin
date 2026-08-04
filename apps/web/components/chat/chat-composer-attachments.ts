/** Library files attached in the chat composer (images for vision, docs for read). */

export type ChatComposerAttachment = {
  assetId: string
  filename: string
  mediaType: string
  updatedAt: string
  /** Base64 (no data: prefix) when kind is image and pixels are loaded for vision. */
  imageBase64?: string
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType === "IMAGE"
}

export function isAttachableMediaType(mediaType: string): boolean {
  // No audio yet — models can't use it in this chat path.
  return mediaType !== "AUDIO"
}

export function attachmentThumbUrl(assetId: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || "/api"
  return `${base.replace(/\/$/, "")}/assets/${assetId}/thumbnail`
}
