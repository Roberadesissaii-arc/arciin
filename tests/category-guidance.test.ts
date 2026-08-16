import { describe, expect, it } from "vitest"

import { ARCIIN_DEFAULT_SYSTEM_INSTRUCTION } from "../apps/web/components/chat/chat-system-instruction"

/**
 * The rules the classifier is actually given.
 *
 * Classification itself is the model's judgement and is deliberately not
 * hardcoded — there is no `if (name.includes("TensorFlow"))` anywhere, and
 * there must never be. What *can* be pinned is the guidance: a catch-all folder
 * is a last resort, ids are opaque, and a failed lookup is re-queried rather
 * than hand-repaired.
 *
 * These exist because a real run put *Strength Training 2nd Edition* into a
 * generic **Books** folder and left *Chess For Dummies* loose. Neither was a
 * code bug; both were the model doing something the instructions permitted.
 */

const INSTRUCTION = ARCIIN_DEFAULT_SYSTEM_INSTRUCTION

describe("catch-all folders are a last resort", () => {
  it("names the folders that must not win by default", () => {
    // A model that has never been told "Books is a bucket" will treat it as a
    // subject, because it looks exactly like one in a folder list.
    for (const bucket of ["Books", "Documents", "PDFs", "Misc", "Other", "Uncategorised"]) {
      expect(INSTRUCTION).toContain(bucket)
    }
  })

  it("says to prefer a real subject, creating one if needed", () => {
    expect(INSTRUCTION).toMatch(/subject folder.*creating that folder if it does not exist/is)
  })

  it("gives the two cases that actually went wrong, as illustrations not rules", () => {
    // Phrased as reasoning about subjects, so it generalises past these two.
    expect(INSTRUCTION).toMatch(/strength-training manual belongs with health and fitness/i)
    expect(INSTRUCTION).toMatch(/chess guide belongs with games and hobbies/i)
    // And crucially: not a filename match.
    expect(INSTRUCTION).not.toMatch(/Strength Training 2nd Edition/)
    expect(INSTRUCTION).not.toMatch(/Chess For Dummies \(/)
  })

  it("still allows a catch-all when the subject genuinely is not clear", () => {
    expect(INSTRUCTION).toMatch(/catch-all only when you genuinely cannot tell/i)
  })
})

describe("opaque identifiers", () => {
  it("forbids inventing or repairing an id", () => {
    expect(INSTRUCTION).toMatch(/Ids are opaque/i)
    expect(INSTRUCTION).toMatch(/never invent, shorten, edit, reconstruct or tidy one/i)
    expect(INSTRUCTION).toMatch(/never repair an id by hand/i)
  })

  it("tells the model what to do when a lookup fails", () => {
    expect(INSTRUCTION).toContain("find_library_file")
    expect(INSTRUCTION).toMatch(/asset_not_found/)
    // The safety rule: act on a unique match only.
    expect(INSTRUCTION).toMatch(/matching_count.*is 1/is)
  })

  it("asks for the filename alongside the id so recovery is possible", () => {
    expect(INSTRUCTION).toMatch(/filename.*alongside its id/is)
  })
})

describe("non-books and uncertainty", () => {
  it("asks whether a file is a book before asking which subject", () => {
    expect(INSTRUCTION).toMatch(/is this a book\?.*before.*which category/is)
  })

  it("names the kinds of file that are not books", () => {
    // The live library is full of these: generated study notes, personal docs.
    expect(INSTRUCTION).toMatch(/invoices, receipts, exports, scans and generated documents/i)
  })

  it("says to leave an unclear file alone rather than force it", () => {
    expect(INSTRUCTION).toMatch(/leave it where it is or put it in a review folder/i)
    expect(INSTRUCTION).toMatch(/rather than forcing it into the nearest category/i)
  })
})

describe("the workflow still insists on doing the work", () => {
  it("tells the model it can move files and must not defer to dragging", () => {
    expect(INSTRUCTION).toMatch(/You \*\*can\*\* move files/i)
    expect(INSTRUCTION).toMatch(/never tell the user to drag files themselves/i)
  })

  it("separates advice from instruction", () => {
    expect(INSTRUCTION).toMatch(/wants a plan/i)
    expect(INSTRUCTION).toMatch(/wants the work done/i)
  })

  it("requires paging to the end before planning an 'organise everything' run", () => {
    expect(INSTRUCTION).toMatch(/until \\?`?has_more\\?`? is false/i)
  })
})
