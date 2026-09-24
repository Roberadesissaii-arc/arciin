import { describe, expect, it } from "vitest"

import { mergeRecordPayload } from "../apps/api/src/services/app-databases/merge-payload"

/**
 * The restaurant regression and the rules around it. See merge-payload.ts.
 */

const pizza = () => ({
  price: 12.99,
  category: "pizza",
  image: {
    assetId: "asset_123",
    title: "Margherita",
    downloadUrl: "/api/assets/asset_123/download",
  },
  tags: ["veg", "classic"],
})

describe("mergeRecordPayload", () => {
  it("restaurant: changing only the price keeps category and image", () => {
    const next = mergeRecordPayload(pizza(), { price: 13.99 })
    expect(next).toEqual({ ...pizza(), price: 13.99 })
  })

  it("nested: changing the image title keeps assetId and downloadUrl", () => {
    const next = mergeRecordPayload(pizza(), { image: { title: "Margherita (large)" } })
    expect(next.image).toEqual({
      assetId: "asset_123",
      title: "Margherita (large)",
      downloadUrl: "/api/assets/asset_123/download",
    })
    expect(next.price).toBe(12.99)
  })

  it("arrays are replaced whole", () => {
    expect(mergeRecordPayload(pizza(), { tags: ["spicy"] }).tags).toEqual(["spicy"])
    expect(mergeRecordPayload(pizza(), { tags: [] }).tags).toEqual([])
  })

  it("explicit null is stored, not treated as a deletion", () => {
    const next = mergeRecordPayload(pizza(), { image: null })
    expect("image" in next).toBe(true)
    expect(next.image).toBeNull()
  })

  it("an object over a primitive (or the reverse) replaces", () => {
    expect(mergeRecordPayload({ a: 1 }, { a: { b: 2 } })).toEqual({ a: { b: 2 } })
    expect(mergeRecordPayload({ a: { b: 2 } }, { a: 5 })).toEqual({ a: 5 })
  })

  it("an empty patch changes nothing", () => {
    expect(mergeRecordPayload(pizza(), {})).toEqual(pizza())
  })

  it("new keys are added", () => {
    expect(mergeRecordPayload({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 })
  })

  it("does not mutate the stored value", () => {
    const stored = pizza()
    mergeRecordPayload(stored, { image: { title: "x" }, price: 1 })
    expect(stored).toEqual(pizza())
  })

  it("a non-object stored payload is treated as empty", () => {
    expect(mergeRecordPayload(null, { a: 1 })).toEqual({ a: 1 })
    expect(mergeRecordPayload([1, 2], { a: 1 })).toEqual({ a: 1 })
  })

  it("never writes prototype keys, even nested", () => {
    const patch = JSON.parse('{"__proto__":{"polluted":true},"image":{"constructor":{"x":1},"title":"t"}}')
    const next = mergeRecordPayload(pizza(), patch)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(next, "__proto__")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(next.image, "constructor")).toBe(false)
    expect((next.image as { title: string }).title).toBe("t")
  })
})
