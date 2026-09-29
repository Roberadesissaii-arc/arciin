import { describe, expect, it } from "vitest"

import { decodeVector, encodeVector, mergeHybrid, topBySimilarity } from "@arciin/shared"

/**
 * How the in-process vector scan scales, with synthetic 768-d vectors (the
 * nomic-embed-text size). Opt-in (ARCIIN_SEMANTIC_BENCH=1): it prints timings
 * and memory for the release notes and docs/SEMANTIC_SEARCH.md, and only
 * asserts generous ceilings so a slow CI box does not fail it.
 */

const RUN = process.env.ARCIIN_SEMANTIC_BENCH === "1"
const DIM = 768

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}

function vectors(n: number, seed = 7): Map<string, Float32Array> {
  const rand = seeded(seed)
  const out = new Map<string, Float32Array>()
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(DIM)
    for (let d = 0; d < DIM; d++) v[d] = rand()
    // Through the stored form, as the API loads them.
    out.set(`asset-${i}`, decodeVector(encodeVector(v)))
  }
  return out
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]!
}

describe.skipIf(!RUN)("semantic scan benchmark", () => {
  it("scans 100 → 100,000 vectors", () => {
    const lines: string[] = []
    const query = [...vectors(1, 99).values()][0]!
    for (const n of [100, 1_000, 10_000, 100_000]) {
      const heapBefore = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers
      const index = vectors(n)
      const heapAfter = process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers
      const runs: number[] = []
      for (let r = 0; r < 7; r++) {
        const t = performance.now()
        // Threshold 0 so the sort does real work; production uses 0.62.
        topBySimilarity(query, index.entries(), -1, 240)
        runs.push(performance.now() - t)
      }
      const literal = Array.from({ length: 200 }, (_, i) => ({ id: `lit-${i}`, originalFilename: `file-${i}.jpg`, title: null }))
      const semantic = Array.from({ length: 60 }, (_, i) => ({ item: { id: `asset-${i}`, originalFilename: `IMG_${i}.jpg`, title: null }, score: 0.7 - i / 1000 }))
      const t = performance.now()
      mergeHybrid("file", literal, semantic)
      const mergeMs = performance.now() - t
      const mb = (heapAfter - heapBefore) / 1024 / 1024
      lines.push(
        `${String(n).padStart(7)} vectors: scan median ${median(runs).toFixed(2)} ms · merge ${mergeMs.toFixed(2)} ms · resident ≈ ${mb.toFixed(1)} MB (raw ${((n * DIM * 4) / 1024 / 1024).toFixed(1)} MB)`,
      )
      if (n === 100_000) expect(median(runs)).toBeLessThan(5_000)
    }
    console.log(lines.join("\n"))
  }, 600_000)
})
