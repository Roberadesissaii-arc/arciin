/**
 * Discord-only brand art (separate from email header / mark).
 *
 * Attached on every webhook post and referenced via attachment:// so embeds
 * show a unique banner without needing a public CDN URL.
 */

import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { DISCORD_BANNER_FILENAME, DISCORD_MARK_FILENAME } from "@arciin/shared"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ASSETS = path.resolve(__dirname, "../../../assets/discord")

let bannerCached: Buffer | null = null
let markCached: Buffer | null = null

export type DiscordBrandFile = {
  filename: string
  content: Buffer
  contentType: string
}

export async function loadDiscordBrandFiles(): Promise<DiscordBrandFile[]> {
  if (!bannerCached) {
    bannerCached = await readFile(path.join(ASSETS, DISCORD_BANNER_FILENAME))
  }
  if (!markCached) {
    markCached = await readFile(path.join(ASSETS, DISCORD_MARK_FILENAME))
  }
  return [
    {
      filename: DISCORD_BANNER_FILENAME,
      content: bannerCached,
      contentType: "image/jpeg",
    },
    {
      filename: DISCORD_MARK_FILENAME,
      content: markCached,
      contentType: "image/png",
    },
  ]
}
