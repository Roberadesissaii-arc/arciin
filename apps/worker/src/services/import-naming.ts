import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"

import { canonicalImportTitle, sanitizeImportFilename, titleStem } from "@arciin/shared"

/**
 * Naming an imported file — kept apart from url-import.ts (queues, database,
 * network) so it can be tested on its own.
 */

/** What yt-dlp's info JSON says about the media — structured, never parsed from console output. */
export type SourceMetadata = {
  id: string | null
  title: string | null
  uploader: string | null
  durationSeconds: number | null
  webpageUrl: string | null
  thumbnail: string | null
  extension: string | null
  extractor: string | null
}

/** Names a page gives the media it carries. */
export type PageNames = { ogTitle: string | null; jsonLdName: string | null; htmlTitle: string | null }

/** What a download knows about its own name. */
export type NamingInput = {
  /** The temporary file's basename; may be a downloader id. */
  filename: string
  sourceTitle?: string | null
  page?: PageNames | null
  contentDispositionName?: string | null
  urlFilename?: string | null
}

/** yt-dlp's `--write-info-json` output for the download, if it wrote one. */
export async function readYtDlpInfo(dir: string): Promise<SourceMetadata | null> {
  try {
    const entries = await readdir(dir)
    const name = entries.find((e) => e.endsWith(".info.json"))
    if (!name) return null
    const info = await stat(path.join(dir, name))
    // Format lists make these large; anything past this is not an info file.
    if (info.size > 32 * 1024 * 1024) return null
    const raw = JSON.parse(await readFile(path.join(dir, name), "utf8")) as Record<string, unknown>
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
    const duration = typeof raw.duration === "number" && Number.isFinite(raw.duration) ? raw.duration : null
    return {
      id: str(raw.id),
      title: str(raw.title) ?? str(raw.fulltitle),
      uploader: str(raw.uploader) ?? str(raw.channel),
      durationSeconds: duration,
      webpageUrl: str(raw.webpage_url),
      thumbnail: str(raw.thumbnail),
      extension: str(raw.ext),
      extractor: str(raw.extractor_key) ?? str(raw.extractor),
    }
  } catch {
    return null
  }
}

/**
 * The imported file's name and title, from the most trustworthy source that
 * says something (see canonicalImportTitle): the inspection candidate the
 * server stored, yt-dlp's title, the page's og:title / JSON-LD / <title>,
 * then Content-Disposition and the URL. A title is kept on the asset only
 * when it names the media (not when it is just a server's filename).
 * Physical storage is unaffected: the object stays `<sha256>.<ext>`.
 */
export function importNaming(
  download: NamingInput,
  opts: { candidateTitle: string | null; extension: string },
): { title: string | null; originalFilename: string } {
  const named = canonicalImportTitle({
    candidateTitle: opts.candidateTitle,
    ytDlpTitle: download.sourceTitle,
    ogTitle: download.page?.ogTitle,
    jsonLdName: download.page?.jsonLdName,
    htmlTitle: download.page?.htmlTitle,
    contentDispositionName: download.contentDispositionName,
    urlFilename: download.urlFilename,
  })
  if (named) return { title: named.descriptive ? named.title : null, originalFilename: sanitizeImportFilename(named.title, opts.extension) }
  // Nothing better: the downloaded name, made safe.
  return { title: null, originalFilename: sanitizeImportFilename(titleStem(download.filename), opts.extension) }
}

