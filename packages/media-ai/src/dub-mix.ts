/**
 * Putting the dub together: original world, new words.
 *
 * The inputs are a background stem and a set of speech clips that each know
 * where on the timeline they belong. The output is one audio track that sounds
 * like the original recording with different dialogue in it.
 *
 * Everything here builds an ffmpeg filter graph rather than shelling out
 * repeatedly, so the whole mix is one pass and one re-encode.
 */

export type PlacedClip = {
  /** Path to a WAV of one synthesised chunk. */
  path: string
  /** Where it starts on the original timeline. */
  startMs: number
  /** 1 = untouched. Applied with atempo, which preserves pitch. */
  rate: number
}

export type MixOptions = {
  backgroundPath: string
  clips: PlacedClip[]
  outputPath: string
  /**
   * Pull the background down under speech.
   *
   * Off by default: if the original mix already ducks its music under
   * dialogue — as most edited video does — separation preserves that, and
   * ducking again would leave the music audibly pumping.
   */
  duck?: boolean
  /** How far to duck, in dB, when enabled. */
  duckDb?: number
}

/**
 * `atempo` only accepts 0.5–2.0 per instance.
 *
 * Well outside anything this pipeline asks for — the timing bounds are
 * 0.85–1.15 — but chained anyway so an out-of-range value degrades into a
 * correct filter rather than an ffmpeg error at mix time.
 */
export function atempoChain(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return "atempo=1.0"
  const parts: string[] = []
  let remaining = rate
  while (remaining > 2.0) {
    parts.push("atempo=2.0")
    remaining /= 2.0
  }
  while (remaining < 0.5) {
    parts.push("atempo=0.5")
    remaining /= 0.5
  }
  parts.push(`atempo=${remaining.toFixed(4)}`)
  return parts.join(",")
}

/**
 * The filter graph for one dub.
 *
 * Input 0 is the background; each clip is an input after it. Clips are delayed
 * to their timeline position, summed, then mixed with the background.
 *
 * `amix` is deliberately not used for the final combine: it normalises by input
 * count, which would drop the background by 6 dB the moment any speech existed
 * and make the music duck and swell with every line. `amerge`-free summing with
 * explicit weights keeps the background at a constant level.
 */
export function buildMixFilter(options: MixOptions): string {
  const { clips, duck = false, duckDb = 6 } = options
  const parts: string[] = []

  if (clips.length === 0) {
    // Nothing spoken: the dub is the original background, untouched.
    return "[0:a]anull[out]"
  }

  const speechLabels: string[] = []
  clips.forEach((clip, index) => {
    const input = index + 1
    const label = `s${index}`
    const filters = [
      // Mono 24 kHz from the provider; match the graph's working format.
      "aresample=48000",
      "aformat=sample_fmts=fltp:channel_layouts=stereo",
      clip.rate === 1 ? null : atempoChain(clip.rate),
      `adelay=${Math.max(0, Math.round(clip.startMs))}|${Math.max(0, Math.round(clip.startMs))}`,
    ].filter(Boolean)
    parts.push(`[${input}:a]${filters.join(",")}[${label}]`)
    speechLabels.push(`[${label}]`)
  })

  // Sum the speech clips. They do not overlap — layoutTimeline guarantees it —
  // so summing cannot stack two voices on top of each other.
  const speechSum =
    speechLabels.length === 1
      ? `${speechLabels[0]}anull[speech]`
      : `${speechLabels.join("")}amix=inputs=${speechLabels.length}:normalize=0[speech]`
  parts.push(speechSum)

  const background = [
    "aresample=48000",
    "aformat=sample_fmts=fltp:channel_layouts=stereo",
  ].join(",")

  if (duck) {
    // Sidechain the background against the speech, so music steps back only
    // while someone is talking.
    parts.push(`[0:a]${background}[bg]`)
    parts.push(
      `[bg][speech]sidechaincompress=threshold=0.05:ratio=${Math.max(2, duckDb / 2)}:attack=20:release=350[bgduck]`,
    )
    parts.push(`[bgduck][speech]amix=inputs=2:normalize=0:duration=longest[mixed]`)
  } else {
    parts.push(`[0:a]${background}[bg]`)
    parts.push(`[bg][speech]amix=inputs=2:normalize=0:duration=longest[mixed]`)
  }

  /**
   * Headroom, not loudness.
   *
   * Summing two full-scale sources clips. A limiter with a little makeup keeps
   * peaks under 0 dBFS without flattening the soundtrack's dynamics the way
   * loudness normalisation would.
   */
  parts.push(`[mixed]alimiter=limit=0.95:level=disabled[out]`)

  return parts.join(";")
}

/** The full ffmpeg argument list for a mix. */
export function buildMixArgs(options: MixOptions): string[] {
  const args = ["-y", "-i", options.backgroundPath]
  for (const clip of options.clips) args.push("-i", clip.path)
  args.push(
    "-filter_complex",
    buildMixFilter(options),
    "-map",
    "[out]",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    options.outputPath,
  )
  return args
}

/**
 * Remux a dub onto the original video.
 *
 * `-c:v copy` on purpose: the picture is untouched, so re-encoding it would
 * cost minutes and lose quality to change nothing.
 */
export function buildRemuxArgs(input: {
  videoPath: string
  audioPath: string
  outputPath: string
}): string[] {
  return [
    "-y",
    "-i", input.videoPath,
    "-i", input.audioPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    input.outputPath,
  ]
}

/** `name.es.dub.m4a` — the language is visible, the original name intact. */
export function dubFilename(
  originalFilename: string,
  language: string,
  kind: "audio" | "video",
): string {
  const match = /^(.*?)(\.[A-Za-z0-9]{1,8})?$/.exec(originalFilename)
  const base = match?.[1] || originalFilename
  const extension = kind === "audio" ? ".m4a" : (match?.[2] ?? ".mp4")
  return `${base}.${language}.dub${extension}`
}
