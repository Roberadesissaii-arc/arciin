import { execa } from "execa"

import { IMPORT_BATCH_MAX_ITEMS } from "@arciin/shared"

import {
  INSTAGRAM_HINT,
  drmBlockedMessage,
  resolveBinary,
} from "@/services/link-extraction"
import { assertExternalDownloadUrlIsPublic, safeRequest } from "@/services/safe-fetch"
import {
  YTDLP_FIRST_HINT,
  categoryForUrl,
  outcomeFromPage,
  outcomeFromYtDlp,
  readTextCapped,
  sourceName,
  type InspectOutcome,
} from "@/services/url-inspect-parse"

/**
 * Look at a link and say what could be imported from it — metadata only.
 *
 * The link is attacker-controlled, so this runs under the import pipeline's
 * rules and tighter limits: the same public-address check before anything
 * connects, the same rebind-safe fetch that re-validates every redirect, a
 * 1 MiB cap on the HTML read, short timeouts, and yt-dlp only ever asked for
 * JSON (`-J --skip-download`), never a file. No cookies are passed: an
 * inspection sees only what the public sees. Only the one page is read —
 * links on it are listed, never followed.
 */

export const INSPECT_HTML_MAX_BYTES = 1024 * 1024
const PAGE_TIMEOUT_MS = 10_000
const YTDLP_TIMEOUT_MS = 20_000
const MAX_REDIRECTS = 4

/** yt-dlp metadata for a link: one video, or the first entries of a playlist / channel / set. */
async function ytDlpInfo(url: string): Promise<unknown | null> {
  await assertExternalDownloadUrlIsPublic(url)
  const single = /[?&]v=/.test(url) || /youtu\.be\//i.test(url)
  try {
    const { stdout } = await execa(
      resolveBinary("yt-dlp", "ARCIIN_YTDLP_BIN"),
      [
        "-J",
        "--skip-download",
        "--no-warnings",
        "--no-progress",
        "--force-ipv4",
        "--socket-timeout",
        "10",
        "--extractor-args",
        "youtube:player_client=android,web",
        ...(single ? ["--no-playlist"] : ["--flat-playlist", "--playlist-end", String(IMPORT_BATCH_MAX_ITEMS * 2)]),
        url,
      ],
      { timeout: YTDLP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, reject: true },
    )
    return JSON.parse(stdout) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error)
    console.warn(`[url-inspect] yt-dlp metadata failed: ${message?.slice(0, 200)}`)
    return null
  }
}

export async function inspectLink(url: string): Promise<InspectOutcome> {
  const drm = drmBlockedMessage(url)
  if (drm) return { kind: "blocked", title: null, items: [], reason: drm }

  // Refuses private / loopback / link-local / metadata addresses, by name and by DNS.
  await assertExternalDownloadUrlIsPublic(url)

  // Instagram needs the import pipeline's embed scraping; inspecting it here
  // would only meet a login wall. It stays the existing single import.
  if (INSTAGRAM_HINT.test(url)) {
    return {
      kind: "single",
      title: null,
      items: [{ url, title: sourceName(url), thumbnail: null, durationSeconds: null, source: sourceName(url), category: "file" }],
      reason: null,
    }
  }

  if (YTDLP_FIRST_HINT.test(url)) {
    const info = await ytDlpInfo(url)
    if (info && typeof info === "object") return outcomeFromYtDlp(info as Parameters<typeof outcomeFromYtDlp>[0], url)
  }

  const response = await safeRequest(url, { timeoutMs: PAGE_TIMEOUT_MS, maxRedirects: MAX_REDIRECTS })
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.stream.destroy()
    throw new Error(`The link responded with ${response.statusCode}.`)
  }
  const contentType = String(response.headers["content-type"] ?? "").toLowerCase()
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    // A file: one item. Nothing of it is downloaded here.
    response.stream.destroy()
    return {
      kind: "single",
      title: null,
      items: [
        {
          url,
          title: decodeURIComponent(new URL(response.finalUrl).pathname.split("/").pop() || "") || sourceName(url),
          thumbnail: null,
          durationSeconds: null,
          source: sourceName(url),
          category: categoryForUrl(response.finalUrl, contentType),
        },
      ],
      reason: null,
    }
  }
  const html = await readTextCapped(response.stream, INSPECT_HTML_MAX_BYTES)
  const outcome = outcomeFromPage(html, response.finalUrl)
  // Keep the address the user gave for a single page; the import resolves it again.
  if (outcome.kind === "single") outcome.items = outcome.items.map((item) => ({ ...item, url }))
  return outcome
}
