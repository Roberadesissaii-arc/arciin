import sharp from "sharp"
import { describe, expect, it } from "vitest"

import { SEMANTIC_MIN_SIMILARITY, buildAssetSemanticText, dot } from "@arciin/shared"

import { captionImageLocally, embedTexts, findLocalVisionModel } from "../packages/media-ai/src/semantic/local-ollama"
import { BIRTHDAY_SCENE_SVG } from "./fixtures/semantic-birthday-scene"

/**
 * The whole IMG_0042 path against a real local Ollama: a picture with no words
 * in it → a local vision caption → the canonical semantic text → a
 * nomic-embed-text vector → found by "birthday party", not by unrelated
 * queries. Opt-in (ARCIIN_LIVE_OLLAMA=1): it needs an installed local vision
 * model and takes about a minute on a CPU-only host.
 */

const LIVE = process.env.ARCIIN_LIVE_OLLAMA === "1"
const BASE = process.env.ARCIIN_SEMANTIC_OLLAMA_URL ?? "http://127.0.0.1:11434"

describe.skipIf(!LIVE)("live local caption → embedding → search", () => {
  it("finds IMG_0042 by what it shows", async () => {
    const vision = await findLocalVisionModel({ baseUrl: BASE })
    if (!vision) throw new Error("no local vision model is installed")
    // Same shape the worker sends: a small JPEG, longest side 256 px.
    const jpeg = await sharp(Buffer.from(BIRTHDAY_SCENE_SVG)).resize(256, 256, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer()

    let t = performance.now()
    const caption = await captionImageLocally({ baseUrl: BASE, model: vision, imageBase64: jpeg.toString("base64") })
    const captionMs = performance.now() - t
    expect(caption.length).toBeGreaterThan(10)

    const text = buildAssetSemanticText({ originalFilename: "IMG_0042.jpg", mediaType: "IMAGE", libraryName: "Images", caption })
    const queries = ["birthday party", "people blowing out candles", "beach sunset", "graduation ceremony", "red car"]
    t = performance.now()
    const [doc, ...qs] = [
      ...(await embedTexts({ baseUrl: BASE, model: "nomic-embed-text", texts: [text], kind: "document" })),
      ...(await embedTexts({ baseUrl: BASE, model: "nomic-embed-text", texts: queries, kind: "query" })),
    ]
    const embedMs = performance.now() - t
    const score = Object.fromEntries(queries.map((q, i) => [q, dot(qs[i]!, doc!)]))
    console.log(
      `vision ${vision}: caption ${(captionMs / 1000).toFixed(1)} s, embeddings ${(embedMs / 1000).toFixed(1)} s\n` +
        `caption: ${caption}\n` +
        queries.map((q) => `  ${q.padEnd(28)} ${score[q]!.toFixed(3)}`).join("\n"),
    )

    expect(score["birthday party"]).toBeGreaterThanOrEqual(SEMANTIC_MIN_SIMILARITY)
    for (const q of ["beach sunset", "graduation ceremony", "red car"]) {
      expect(score[q], q).toBeLessThan(SEMANTIC_MIN_SIMILARITY)
    }
  }, 900_000)
})
