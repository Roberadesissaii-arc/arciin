import type { ImageHighlightRegion } from "@/lib/files/image-highlight-types"
import { parseGeminiBoundingBoxes } from "@/lib/files/parse-gemini-bounding-boxes"
import {
  parseAssistantImageRegions,
  regionFromGrid,
} from "@/lib/files/parse-image-point-tags"

const ORDINAL: Record<string, number> = {
  first: 1,
  "1st": 1,
  one: 1,
  second: 2,
  "2nd": 2,
  two: 2,
  third: 3,
  "3rd": 3,
  three: 3,
  fourth: 4,
  "4th": 4,
  four: 4,
  fifth: 5,
  "5th": 5,
  five: 5,
  sixth: 6,
  "6th": 6,
  six: 6,
  seventh: 7,
  "7th": 7,
  seven: 7,
  eighth: 8,
  "8th": 8,
  ninth: 9,
  "9th": 9,
  tenth: 10,
  "10th": 10,
}

const ROW_WORD: Record<string, number> = {
  top: 1,
  upper: 1,
  first: 1,
  middle: 2,
  center: 2,
  second: 2,
  mid: 2,
  bottom: 3,
  lower: 3,
  third: 3,
}

function parseOrdinal(word: string): number | undefined {
  const n = Number.parseInt(word, 10)
  if (Number.isFinite(n) && n >= 1 && n <= 20) return n
  return ORDINAL[word.toLowerCase()]
}

/** Infer grid dimensions from row references in assistant text (posters, infographics). */
export function inferGridSizeFromText(text: string): { rows: number; cols: number } {
  let maxRow = 0
  for (const m of text.matchAll(
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)?)\s+row(?:\s+from\s+the\s+top)?/gi,
  )) {
    const row = parseOrdinal(m[1]!)
    if (row) maxRow = Math.max(maxRow, row)
  }
  for (const m of text.matchAll(/\brow\s+(\d{1,2})\b/gi)) {
    const row = Number.parseInt(m[1]!, 10)
    if (Number.isFinite(row)) maxRow = Math.max(maxRow, row)
  }

  const infographic =
    maxRow > 4 ||
    /\bfrom the top\b/i.test(text) ||
    /\b(?:poster|infographic|chart|lineup)\b/i.test(text)

  return {
    rows: Math.max(maxRow, 3),
    cols: infographic ? 5 : 4,
  }
}

function labelFromInfographicBlock(block: string): string | undefined {
  const name =
    block.match(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:'s)?\s*(?:car|mercedes|ferrari|mclaren|red bull)/i,
    )?.[1] ??
    block.match(/\b(Mercedes|Ferrari|McLaren|Red Bull|AlphaTauri)\b/i)?.[1] ??
    block.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/)?.[1]
  return name?.trim().slice(0, 32)
}

type GridHit = { row: number; col: number; label?: string; cols?: number }

/** Poster/infographic rows: "fourth row from the top" + car → left column box. */
function hitsFromInfographicRows(text: string): GridHit[] {
  const hits: GridHit[] = []
  const chunks = text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)

  for (const chunk of chunks) {
    const rowMatch = chunk.match(
      /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)?)\s+row(?:\s+from\s+the\s+top)?/i,
    )
    if (!rowMatch) continue
    const row = parseOrdinal(rowMatch[1]!)
    if (!row) continue

    const targetsObject =
      /\b(car|cars|glass|drink|driver|helmet|item|one)\b/i.test(chunk) ||
      /\b(mercedes|ferrari|mclaren|red bull)\b/i.test(chunk)
    if (!targetsObject && !/\bshown in\b/i.test(chunk)) continue

    const col = /\bcar\b/i.test(chunk) ? 1 : 1
    hits.push({ row, col, label: labelFromInfographicBlock(chunk) })
  }

  return hits
}

export function isSingularPickQuery(query: string): boolean {
  const q = query.toLowerCase()
  if (/\b(both|all|each|two|compare|versus|vs\.?)\b/.test(q)) return false
  return (
    /\bthe fastest\b/.test(q) ||
    /\bwhich\b[\s\S]{0,80}\b(?:one|fastest|best|main|primary)\b/.test(q)
  )
}

function parseRowWord(word: string): number | undefined {
  const n = Number.parseInt(word, 10)
  if (Number.isFinite(n) && n >= 1 && n <= 12) return n
  return ROW_WORD[word.toLowerCase()]
}

function labelFromSentence(sentence: string, preferKeywords: string[] = []): string | undefined {
  for (const kw of preferKeywords) {
    if (sentence.toLowerCase().includes(kw.toLowerCase())) {
      return kw.replace(/\b\w/g, (c) => c.toUpperCase())
    }
  }
  const trimmed = sentence.trim()
  if (trimmed.length < 4 || trimmed.length > 80) return undefined
  const m = trimmed.match(/(?:the\s+)?((?:dark\s+)?brown[^,.]{0,20}|[^,.]{4,32}(?:drink|glass))/i)
  return m?.[1]?.trim().slice(0, 32)
}

function hitsFromBreakdown(text: string, preferKeywords: string[]): GridHit[] {
  if (!/\bmiddle row\b/i.test(text)) return []
  const middleSection =
    text.match(/middle row:[\s\S]*?(?=bottom row|top row|$)/i)?.[0] ?? text
  const hits: GridHit[] = []
  const row = 2
  const label =
    preferKeywords[0] != null
      ? preferKeywords[0]!.replace(/\b\w/g, (c) => c.toUpperCase())
      : undefined

  if (
    /\bleft:\s*[^.\n]*\bbrown\b/i.test(middleSection) &&
    !/\bleft:\s*[^.\n]*\blight brown\b/i.test(middleSection)
  ) {
    hits.push({ row, col: 1, label: label ?? "Brown drink" })
  }
  if (/\bcent(?:er|re):\s*[^.\n]*\bbrown\b/i.test(middleSection)) {
    hits.push({ row, col: 2, label: label ?? "Brown drink" })
  }
  if (
    /\bright:\s*[^.\n]*\bbrown\b/i.test(middleSection) &&
    !/\bright:\s*[^.\n]*\b(?:pink|orange|peach)\b/i.test(middleSection)
  ) {
    hits.push({ row, col: 4, label: label ?? "Brown drink" })
  }

  return hits
}

function hitsFromSentence(sentence: string, preferKeywords: string[] = []): GridHit[] {
  const hits: GridHit[] = []
  const label = labelFromSentence(sentence, preferKeywords)

  for (const m of sentence.matchAll(
    /(top|middle|bottom)\s+row[\s\S]{0,60}?(first|second|third|fourth|\d+(?:st|nd|rd|th)?)\s+col(?:umn)?/gi,
  )) {
    const row = parseRowWord(m[1]!)
    const col = parseOrdinal(m[2]!)
    if (row && col) hits.push({ row, col, label })
  }

  const numeric = [
    ...sentence.matchAll(
      /(?:row|Row)\s*(\d+|[a-z]+)[^\n.]{0,50}?(?:col(?:umn)?|Col(?:umn)?)\s*(\d+|[a-z]+)/gi,
    ),
    ...sentence.matchAll(
      /(\d+|[a-z]+)\s*(?:st|nd|rd|th)?\s*row[^\n.]{0,50}?(\d+|[a-z]+)\s*(?:st|nd|rd|th)?\s*(?:col(?:umn)?|glass|drink)/gi,
    ),
  ]
  for (const m of numeric) {
    const row = parseRowWord(m[1]!) ?? parseOrdinal(m[1]!)
    const col = parseOrdinal(m[2]!) ?? parseRowWord(m[2]!)
    if (row && col) hits.push({ row, col, label })
  }

  for (const m of sentence.matchAll(
    /(first|second|third|fourth|\d+(?:st|nd|rd|th)?)\s+row[\s\S]{0,48}?(first|second|third|fourth|\d+(?:st|nd|rd|th)?)\s+col(?:umn)?/gi,
  )) {
    const row = parseOrdinal(m[1]!) ?? parseRowWord(m[1]!)
    const col = parseOrdinal(m[2]!)
    if (row && col) hits.push({ row, col, label })
  }

  for (const m of sentence.matchAll(
    /(first|second|third|fourth|\d+(?:st|nd|rd|th)?)\s+(?:glass|drink|item|one|cup)[^.]{0,40}?(?:from the )?(?:left|right)(?:[^.]{0,40}?(?:in )?(?:the )?(top|middle|bottom)\s+row)?/gi,
  )) {
    const col = parseOrdinal(m[1]!)
    const row = m[2] ? parseRowWord(m[2]!) : undefined
    if (col && row) hits.push({ row, col, label })
  }

  for (const m of sentence.matchAll(
    /(top|middle|bottom)\s+row[^.]{0,50}?(first|second|third|fourth|\d+(?:st|nd|rd|th)?)\s+(?:glass|drink|item|one)[^.]{0,20}?(?:from the )?left/gi,
  )) {
    const row = parseRowWord(m[1]!)
    const col = parseOrdinal(m[2]!)
    if (row && col) hits.push({ row, col, label })
  }

  for (const m of sentence.matchAll(
    /(top|middle|bottom)\s+row[^.]{0,40}?(first|second|third|fourth|\d+(?:st|nd|rd|th)?)\s+(?:from the )?left/gi,
  )) {
    const row = parseRowWord(m[1]!)
    const col = parseOrdinal(m[2]!)
    if (row && col) hits.push({ row, col, label })
  }

  return hits
}

export function userWantsImagePointing(query: string): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return false

  // General Q&A — never draw boxes unless they also ask to point/highlight.
  if (
    /\b(?:how many|how much|count the|list the|describe|summarize|summary|what text|explain|tell me about|what do you see|what's in|what is in)\b/.test(
      q,
    ) &&
    !/\b(?:point|highlight|circle|locate|mark|box|border|show me where|where is)\b/.test(q)
  ) {
    return false
  }

  return (
    /\b(?:point(?:\s+to|\s+out|\s+at)?|highlight|circle(?:\s+around)?|show me(?:\s+where)?|where is|locate|mark(?:\s+it)?|box(?:\s+around)?|border(?:\s+around)?|draw a (?:border|box)|find (?:it|them) on the image)\b/i.test(
      q,
    ) ||
    /\bwhich (?:one|object|item|car|drink|glass|book|books|person|thing|subject|lens|camera)\b/i.test(
      q,
    ) ||
    /\bwhich(?:\s+one)?\s+is\s+the\b/i.test(q) ||
    /\bon the image\b/i.test(q)
  )
}

export function pointingKeywordsFromUser(query: string): string[] {
  const kw: string[] = []
  const patterns = [
    /\b(brown|dark brown|amber|red|orange|pink|peach|cola|chocolate|cream|clear|empty)\b/gi,
    /\b(lens|camera|body|drink|glass|car|book|phone|watch|bottle|bag|shoe|box)\b/gi,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(query)) !== null) {
      const w = m[1]!.toLowerCase()
      if (!kw.includes(w)) kw.push(w)
    }
  }
  return kw
}

function labelFromSideSentence(sentence: string, preferKeywords: string[]): string | undefined {
  for (const kw of preferKeywords) {
    if (sentence.toLowerCase().includes(kw.toLowerCase())) {
      return kw.replace(/\b\w/g, (c) => c.toUpperCase())
    }
  }
  const bold = sentence.match(/\*\*([^*]+)\*\*/)?.[1]?.trim()
  if (bold && bold.length <= 32) return bold
  const theIs = sentence.match(/\bthe\s+([a-z][a-z\s]{1,24}?)\s+is\b/i)?.[1]?.trim()
  if (theIs && theIs.length <= 32) return theIs
  return undefined
}

/** Side-by-side layouts: "on the right side", "left of the image" → 1×2 grid cell. */
function hitsFromSidePosition(text: string, preferKeywords: string[]): GridHit[] {
  const hits: GridHit[] = []
  const sentences = text.split(/(?<=[.!?\n])\s+|\n+/).map((s) => s.trim()).filter(Boolean)

  for (const sentence of sentences) {
    const label = labelFromSideSentence(sentence, preferKeywords)
    const mentionsSubject =
      Boolean(label) ||
      preferKeywords.some((kw) => sentence.toLowerCase().includes(kw.toLowerCase())) ||
      /\b(?:lens|camera|body|object|item|one)\b/i.test(sentence)

    if (!mentionsSubject) continue

    if (
      /\b(?:on|to|at)\s+the\s+right(?:\s+side)?(?:\s+of\s+(?:the\s+)?(?:image|photo|picture))?\b/i.test(
        sentence,
      ) ||
      /\bright(?:\s+side)?\s+of\s+the\s+(?:image|photo|picture)\b/i.test(sentence) ||
      /\b(?:object|item|one)\s+on\s+the\s+right\b/i.test(sentence)
    ) {
      hits.push({ row: 1, col: 2, label })
      continue
    }

    if (
      /\b(?:on|to|at)\s+the\s+left(?:\s+side)?(?:\s+of\s+(?:the\s+)?(?:image|photo|picture))?\b/i.test(
        sentence,
      ) ||
      /\bleft(?:\s+side)?\s+of\s+the\s+(?:image|photo|picture)\b/i.test(sentence) ||
      /\b(?:object|item|one)\s+on\s+the\s+left\b/i.test(sentence)
    ) {
      hits.push({ row: 1, col: 1, label })
      continue
    }

    if (/\b(?:in\s+the\s+)?(?:center|centre|middle)\b/i.test(sentence)) {
      hits.push({ row: 1, col: 2, label, cols: 3 })
    }
  }

  return hits
}

export function inferSidePositionRegions(
  text: string,
  options?: InferImageRegionsOptions,
): ImageHighlightRegion[] {
  const preferKeywords = options?.preferKeywords ?? []
  const seen = new Set<string>()
  const out: ImageHighlightRegion[] = []

  for (const hit of hitsFromSidePosition(text, preferKeywords)) {
    const cols = hit.cols ?? 2
    const key = `${hit.row}:${hit.col}:${cols}:${(hit.label ?? "").toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const region = regionFromGrid(hit.row, hit.col, 1, cols, hit.label)
    if (region) out.push(region)
  }

  return out
}

function regionCenterX(region: ImageHighlightRegion): number {
  return (region.x1 + region.x2) / 2
}

/** True when model box center is in the half implied by prose (left vs right). */
function modelRegionsAgreeWithSide(
  modelRegions: ImageHighlightRegion[],
  sideRegions: ImageHighlightRegion[],
): boolean {
  const side = sideRegions[0]
  const model = modelRegions[0]
  if (!side || !model) return modelRegions.length === 0

  const sideCenter = regionCenterX(side)
  const modelCenter = regionCenterX(model)
  const proseIsRight = sideCenter >= 520
  const proseIsLeft = sideCenter <= 480

  if (proseIsRight) return modelCenter >= 480
  if (proseIsLeft) return modelCenter <= 520
  return Math.abs(modelCenter - sideCenter) < 280
}

export function assistantDescribesGridPosition(text: string): boolean {
  return /\b(row|column|col\b|glass|drink|car|middle row|top row|bottom row|from the top|from the left|left side|right side|on the left|on the right)\b/i.test(
    text,
  )
}

export function inferInfographicRowRegions(
  text: string,
  options?: InferImageRegionsOptions,
): ImageHighlightRegion[] {
  const { rows, cols } = inferGridSizeFromText(text)
  const safeRows = options?.defaultRows ?? rows
  const safeCols = options?.defaultCols ?? cols
  const seen = new Set<string>()
  const out: ImageHighlightRegion[] = []

  for (const hit of hitsFromInfographicRows(text)) {
    const key = `${hit.row}:${hit.col}:${(hit.label ?? "").toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const region = regionFromGrid(hit.row, hit.col, safeRows, safeCols, hit.label)
    if (region) out.push(region)
  }

  return out
}

export type InferImageRegionsOptions = {
  defaultRows?: number
  defaultCols?: number
  /** Prefer sentences mentioning these words (from the user question). */
  preferKeywords?: string[]
}

export function inferImageRegionsFromProse(
  text: string,
  options?: InferImageRegionsOptions,
): ImageHighlightRegion[] {
  const normalized = text.replace(/\*\*/g, "").replace(/\*/g, "")
  const inferred = inferGridSizeFromText(normalized)
  const rows = options?.defaultRows ?? inferred.rows
  const cols = options?.defaultCols ?? inferred.cols
  const preferKeywords = options?.preferKeywords ?? []

  let sentences = normalized.split(/(?<=[.!?\n])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
  if (preferKeywords.length > 0) {
    const preferred = sentences.filter((s) =>
      preferKeywords.some((kw) => s.toLowerCase().includes(kw.toLowerCase())),
    )
    if (preferred.length > 0) sentences = preferred
  }

  const seen = new Set<string>()
  const out: ImageHighlightRegion[] = []

  for (const hit of hitsFromBreakdown(normalized, preferKeywords)) {
    const key = `${hit.row}:${hit.col}:${(hit.label ?? "").toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    const region = regionFromGrid(hit.row, hit.col, rows, cols, hit.label)
    if (region) out.push(region)
  }

  for (const sentence of sentences) {
    if (
      !/\b(row|column|col\b|glass|drink|left|right|top|middle|bottom|side)\b/i.test(sentence)
    ) {
      continue
    }
    for (const hit of hitsFromSentence(sentence, preferKeywords)) {
      const key = `${hit.row}:${hit.col}:${(hit.label ?? "").toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      const region = regionFromGrid(hit.row, hit.col, rows, cols, hit.label)
      if (region) out.push(region)
    }
  }

  return out
}

export type ResolveImageRegionsOptions = InferImageRegionsOptions & {
  allowProseFallback?: boolean
  /** Original user question — used to cap multi-box answers for singular picks. */
  userQuery?: string
}

function capRegionsForSingularQuery(
  regions: ImageHighlightRegion[],
  userQuery?: string,
): ImageHighlightRegion[] {
  if (!userQuery || regions.length <= 1) return regions
  if (!isSingularPickQuery(userQuery)) return regions
  return [regions[0]!]
}

/** Parse model tags; prefer side/row prose when coordinates disagree with the answer text. */
export function resolveImageHighlightRegions(
  text: string,
  options?: ResolveImageRegionsOptions,
): ImageHighlightRegion[] {
  const tagged = parseAssistantImageRegions(text)
  const sideRegions = inferSidePositionRegions(text, options)
  const rowRegions = inferInfographicRowRegions(text, options)
  const geminiBoxes = parseGeminiBoundingBoxes(text)

  const proseRegions = sideRegions.length > 0 ? sideRegions : rowRegions
  const modelRegions = tagged.length > 0 ? tagged : geminiBoxes

  if (proseRegions.length > 0) {
    if (modelRegions.length === 0 || !modelRegionsAgreeWithSide(modelRegions, proseRegions)) {
      return capRegionsForSingularQuery(proseRegions, options?.userQuery)
    }
  }

  if (tagged.length > 0) return capRegionsForSingularQuery(tagged, options?.userQuery)

  if (rowRegions.length > 0) {
    return capRegionsForSingularQuery(rowRegions, options?.userQuery)
  }

  if (geminiBoxes.length > 0) {
    return capRegionsForSingularQuery(geminiBoxes, options?.userQuery)
  }

  if (options?.allowProseFallback === false) return []
  return capRegionsForSingularQuery(inferImageRegionsFromProse(text, options), options?.userQuery)
}
