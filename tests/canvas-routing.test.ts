import { describe, expect, it } from "vitest"

import {
  isCanvasWritingIntent,
  mentionsCanvasExplicitly,
  shouldAutoOpenCanvas,
} from "@/components/chat/chat-canvas-helpers"

/**
 * Canvas routing, against the two messages that exposed it.
 *
 * A user asked for a chemistry study note with the Canvas chip switched on and
 * got a chat reply, because "note" was not in the intent vocabulary. They then
 * said "add that one into my canvas" — which matched nothing either, so the
 * turn kept its tools and the model created a `study_notes` table in an App
 * data database instead of writing anything.
 */

const CHEMISTRY_NOTE =
  "Hey, I wanna learn about chemistry so like you know how proton electron works " +
  "and how each element basically creates a shell. Can you basically explain it to me? " +
  "Or like creating like a study note describing in detail how we count them?"

const INTO_MY_CANVAS = "OK now I want you to create or add that one into my canvas. With a beautiful note."

describe("naming the canvas", () => {
  it.each([
    "add that one into my canvas",
    "put it in the canvas",
    "write this in canvas",
    "save that to my canvas",
    "open the canvas and write it there",
    "canvas this",
  ])("recognises %j", (text) => {
    expect(mentionsCanvasExplicitly(text)).toBe(true)
  })

  it("does not fire on unrelated uses of the word", () => {
    expect(mentionsCanvasExplicitly("what is a canvas print")).toBe(false)
    expect(mentionsCanvasExplicitly("find my canvas painting photos")).toBe(false)
  })

  it("outranks the list/question guards", () => {
    // Reads like a list request, but the user said where they want the output.
    expect(isCanvasWritingIntent("list all my books in the canvas")).toBe(true)
  })
})

describe("routing without the chip", () => {
  it("routes the two messages that failed", () => {
    expect(shouldAutoOpenCanvas(CHEMISTRY_NOTE)).toBe(true)
    expect(shouldAutoOpenCanvas(INTO_MY_CANVAS)).toBe(true)
  })

  it.each([
    "write me an essay about the French revolution",
    "create a study note on photosynthesis",
    "make a cheat sheet for the periodic table",
    "prepare an exam from this chapter",
    "generate documentation for the upload flow",
  ])("routes %j", (text) => {
    expect(shouldAutoOpenCanvas(text)).toBe(true)
  })

  it.each([
    "list all the pdf",
    "how many videos do I have",
    "what is a study guide",
    "summarize this file for me",
    "show my documents",
    "hey how are you",
    "search my library for the tax report",
  ])("leaves %j in chat", (text) => {
    expect(shouldAutoOpenCanvas(text)).toBe(false)
  })
})

describe("chip-on intent still covers notes", () => {
  it("accepts the chemistry note request", () => {
    // This is the one the user had the chip on for, and still got chat.
    expect(isCanvasWritingIntent(CHEMISTRY_NOTE)).toBe(true)
  })

  it("keeps rejecting plain library questions", () => {
    expect(isCanvasWritingIntent("list all my books")).toBe(false)
    expect(isCanvasWritingIntent("how many images do I have")).toBe(false)
  })
})
