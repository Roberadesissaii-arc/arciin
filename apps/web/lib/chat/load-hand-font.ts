/**
 * The handwriting face, fetched once and kept.
 *
 * Served from /public rather than bundled: the file is 112 KB, and a reader who
 * never exports a PDF should not be made to download a font for a feature they
 * did not use. Cached after the first export so a second one is instant.
 */

import { readTrueTypeMetrics } from "@/lib/chat/truetype-metrics"
import type { EmbeddedHandFont } from "@/lib/chat/canvas-export"

let cached: EmbeddedHandFont | null = null
let attempted = false

export async function loadHandFont(): Promise<EmbeddedHandFont | undefined> {
  if (cached) return cached
  // One attempt per session: a missing font is a deployment problem, and
  // retrying it on every export just makes each one slower.
  if (attempted) return undefined
  attempted = true

  try {
    const response = await fetch("/fonts/caveat/Caveat-Regular.ttf")
    if (!response.ok) return undefined
    const bytes = new Uint8Array(await response.arrayBuffer())
    const metrics = readTrueTypeMetrics(bytes)
    // Without metrics the PDF would declare no widths and lay the text out
    // wrongly; falling back to Times is the better failure.
    if (!metrics) return undefined
    cached = { bytes, metrics }
    return cached
  } catch {
    return undefined
  }
}
