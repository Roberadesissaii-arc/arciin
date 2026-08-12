/**
 * Brand images for every outbound Arciin email.
 *
 * Both files are generated once and stored under apps/api/assets/email/.
 * Attached as inline CIDs so clients show the same art without remote loads.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { ARCIIN_EMAIL_BRAND_CID, ARCIIN_EMAIL_HEADER_CID } from "@arciin/shared"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.resolve(__dirname, "../../../assets/email")

const HEADER_PATH = path.join(ASSETS, "arciin-email-header.jpg")
const BRAND_PATH = path.join(ASSETS, "arciin-brand.png")

let headerCached: Buffer | null = null
let brandCached: Buffer | null = null

async function loadHeader(): Promise<Buffer> {
  if (headerCached) return headerCached
  headerCached = await readFile(HEADER_PATH)
  return headerCached
}

async function loadBrand(): Promise<Buffer> {
  if (brandCached) return brandCached
  brandCached = await readFile(BRAND_PATH)
  return brandCached
}

export type InlineEmailImage = {
  filename: string
  content: Buffer
  contentType: string
  cid: string
  contentDisposition: "inline"
}

/** Header banner + square mark — always attached together. */
export async function arciinEmailInlineImages(): Promise<InlineEmailImage[]> {
  const [header, brand] = await Promise.all([loadHeader(), loadBrand()])
  return [
    {
      filename: "arciin-email-header.jpg",
      content: header,
      contentType: "image/jpeg",
      cid: ARCIIN_EMAIL_HEADER_CID,
      contentDisposition: "inline",
    },
    {
      filename: "arciin-brand.png",
      content: brand,
      contentType: "image/png",
      cid: ARCIIN_EMAIL_BRAND_CID,
      contentDisposition: "inline",
    },
  ]
}

/** @deprecated prefer arciinEmailInlineImages */
export async function arciinEmailBrandAttachment(): Promise<InlineEmailImage> {
  const all = await arciinEmailInlineImages()
  return all[1]!
}
