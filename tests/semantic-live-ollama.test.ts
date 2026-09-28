import { describe, expect, it } from "vitest"

import { SEMANTIC_MIN_SIMILARITY, buildAssetSemanticText, dot } from "@arciin/shared"

import { embedTexts, localModelStatus } from "../packages/media-ai/src/semantic/local-ollama"
import { SEMANTIC_CORPUS, SEMANTIC_QUERIES } from "./fixtures/semantic-corpus"

/**
 * Against a real local Ollama with nomic-embed-text installed. Opt-in
 * (ARCIIN_LIVE_OLLAMA=1) so the unit suite never depends on a model being
 * present. This is also how SEMANTIC_MIN_SIMILARITY was chosen: it prints the
 * relevant/unrelated score distributions and recall/false hits per threshold.
 */

const LIVE = process.env.ARCIIN_LIVE_OLLAMA === "1"
const BASE = process.env.ARCIIN_SEMANTIC_OLLAMA_URL ?? "http://127.0.0.1:11434"
const MODEL = "nomic-embed-text"

describe.skipIf(!LIVE)("live local Ollama", () => {
  it("the model is installed and reports 768 dimensions", async () => {
    const status = await localModelStatus({ baseUrl: BASE, model: MODEL })
    expect(status.ollama).toBe("online")
    if (status.ollama !== "online" || !status.installed) throw new Error("nomic-embed-text is not installed")
    expect(status.model.dimension).toBe(768)
    expect(status.model.digest).toBeTruthy()
  })

  it("finds each topic by meaning, and nothing for unrelated queries, at the chosen threshold", async () => {
    const texts = SEMANTIC_CORPUS.map((c) => buildAssetSemanticText(c))
    let t = performance.now()
    const docs = await embedTexts({ baseUrl: BASE, model: MODEL, texts, kind: "document" })
    const docMs = performance.now() - t
    const relevant: number[] = []
    const unrelated: number[] = []
    const queryMs: number[] = []
    const lines: string[] = []
    for (const q of SEMANTIC_QUERIES) {
      t = performance.now()
      const [qv] = await embedTexts({ baseUrl: BASE, model: MODEL, texts: [q.query], kind: "query" })
      queryMs.push(performance.now() - t)
      const scored = SEMANTIC_CORPUS.map((c, i) => ({ key: c.key, topic: c.topic, s: dot(qv!, docs[i]!) })).sort((a, b) => b.s - a.s)
      for (const s of scored) (q.topic && s.topic === q.topic ? relevant : unrelated).push(s.s)
      const top = scored[0]!
      const bestOther = scored.find((s) => s.topic !== q.topic)!
      lines.push(
        `${q.query.padEnd(32)} top ${top.key} ${top.s.toFixed(3)} | best unrelated ${bestOther.key} ${bestOther.s.toFixed(3)}`,
      )
      if (q.topic) expect(top.topic, q.query).toBe(q.topic)
    }
    relevant.sort((a, b) => a - b)
    unrelated.sort((a, b) => a - b)
    const at = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))]!
    lines.push(`relevant  n=${relevant.length} min ${relevant[0]!.toFixed(3)} p10 ${at(relevant, 0.1).toFixed(3)} median ${at(relevant, 0.5).toFixed(3)}`)
    lines.push(`unrelated n=${unrelated.length} median ${at(unrelated, 0.5).toFixed(3)} p99 ${at(unrelated, 0.99).toFixed(3)} max ${unrelated.at(-1)!.toFixed(3)}`)
    for (const th of [0.5, 0.55, 0.58, 0.6, 0.62, 0.65, 0.68, 0.7]) {
      const tp = relevant.filter((x) => x >= th).length
      const fp = unrelated.filter((x) => x >= th).length
      lines.push(`threshold ${th.toFixed(2)}: recall ${Math.round((100 * tp) / relevant.length)}% (${tp}/${relevant.length}) · false hits ${fp}/${unrelated.length}`)
    }
    queryMs.sort((a, b) => a - b)
    lines.push(`document embed ${(docMs / texts.length).toFixed(1)} ms/item (batched ${texts.length}); query embed median ${at(queryMs, 0.5).toFixed(1)} ms`)
    console.log(lines.join("\n"))

    // At the shipped threshold nothing unrelated clears the bar.
    expect(unrelated.filter((x) => x >= SEMANTIC_MIN_SIMILARITY)).toEqual([])
  }, 900_000)
})
