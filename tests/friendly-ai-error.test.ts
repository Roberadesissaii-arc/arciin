import { describe, expect, it } from "vitest"

import { friendlyAiError } from "../apps/web/lib/ai/friendly-ai-error"
import { friendlyGeminiErrorMessage } from "../apps/api/src/services/ai/friendly-gemini-error"

describe("friendlyAiError", () => {
  it("turns a Gemini quota JSON dump into a short toast", () => {
    const raw = JSON.stringify({
      error: {
        code: 429,
        message:
          "You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash\nPlease retry in 26.283960727s.",
        status: "RESOURCE_EXHAUSTED",
      },
    })
    const friendly = friendlyAiError(new Error(raw))
    expect(friendly.title).toBe("AI limit reached")
    expect(friendly.description).toMatch(/about \d+s/)
    expect(friendly.description).not.toMatch(/generativelanguage/)
  })

  it("keeps short human messages", () => {
    const friendly = friendlyAiError(new Error("Generate a transcript first."), {
      title: "Could not suggest a title",
      description: "Try again.",
    })
    expect(friendly.description).toMatch(/transcript/i)
  })
})

describe("friendlyGeminiErrorMessage", () => {
  it("maps RESOURCE_EXHAUSTED to a short API message", () => {
    const friendly = friendlyGeminiErrorMessage(
      new Error('{"error":{"status":"RESOURCE_EXHAUSTED","message":"You exceeded your current quota"}}'),
      "fallback",
    )
    expect(friendly.code).toBe("AI_QUOTA_EXCEEDED")
    expect(friendly.message).toMatch(/limit reached/i)
    expect(friendly.message.length).toBeLessThan(120)
  })
})
