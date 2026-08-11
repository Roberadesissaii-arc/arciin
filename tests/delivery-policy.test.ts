import { describe, expect, it } from "vitest"

import {
  DELIVERY_CHAT_TOOLS,
  FORBIDDEN_DELIVERY_ARGUMENTS,
  DELIVERY_MAX_BYTES,
  checkDeliverable,
  describeDestination,
  describeWebhook,
  isValidDiscordWebhookUrl,
  maskEmail,
  matchAssetByName,
} from "@arciin/shared"

/**
 * The assistant can send a file to the user's email or Discord.
 *
 * The security property being defended here is that it cannot send a file
 * *anywhere else*. The assistant reads the user's own PDFs and source files, so
 * a destination parameter would mean any sentence inside any document could
 * redirect an attachment to a stranger.
 */

describe("the delivery tools expose no destination parameter", () => {
  const deliveryTools = DELIVERY_CHAT_TOOLS

  it("registers both delivery tools", () => {
    expect(deliveryTools.map((t) => t.function.name).sort()).toEqual([
      "send_asset_to_discord",
      "send_asset_to_email",
    ])
  })

  it("accepts no recipient, address, webhook or channel argument", () => {
    // This is the whole defence. If a future change adds one of these, the
    // assistant becomes an exfiltration primitive pointed at the library.
    const forbidden: readonly string[] = FORBIDDEN_DELIVERY_ARGUMENTS

    for (const tool of deliveryTools) {
      const properties = Object.keys(tool.function.parameters?.properties ?? {})
      for (const name of properties) {
        expect(forbidden).not.toContain(name.toLowerCase())
      }
    }
  })

  it("only accepts a file selector and an optional note", () => {
    for (const tool of deliveryTools) {
      const properties = Object.keys(
        tool.function.parameters?.properties ?? {},
      ).sort()
      expect(properties).toEqual(["asset_id", "filename", "note"])
    }
  })

  it("tells the model in the description that it cannot choose the destination", () => {
    for (const tool of deliveryTools) {
      expect(tool.function.description.toLowerCase()).toContain("cannot choose")
    }
  })
})

describe("checkDeliverable", () => {
  const asset = { sizeBytes: 1024, status: "READY", deletedAt: null }
  const configured = { channelConfigured: true, hasDestination: true }

  it("allows a normal file", () => {
    expect(checkDeliverable({ channel: "email", ...configured, asset })).toEqual({
      allowed: true,
    })
  })

  it("refuses when the channel is not set up", () => {
    expect(
      checkDeliverable({ channel: "discord", channelConfigured: false, hasDestination: false, asset }),
    ).toMatchObject({ code: "CHANNEL_NOT_CONFIGURED" })
  })

  it("refuses when configured but with nowhere to send", () => {
    expect(
      checkDeliverable({ channel: "email", channelConfigured: true, hasDestination: false, asset }),
    ).toMatchObject({ code: "NO_DESTINATION" })
  })

  it("refuses a missing or trashed file", () => {
    expect(checkDeliverable({ channel: "email", ...configured, asset: null })).toMatchObject({
      code: "ASSET_NOT_FOUND",
    })
    expect(
      checkDeliverable({
        channel: "email",
        ...configured,
        asset: { ...asset, deletedAt: new Date() },
      }),
    ).toMatchObject({ code: "ASSET_NOT_FOUND" })
    expect(
      checkDeliverable({ channel: "email", ...configured, asset: { ...asset, status: "DELETED" } }),
    ).toMatchObject({ code: "ASSET_NOT_FOUND" })
  })

  it("refuses a file that failed processing", () => {
    expect(
      checkDeliverable({ channel: "email", ...configured, asset: { ...asset, status: "FAILED" } }),
    ).toMatchObject({ code: "ASSET_NOT_READY" })
  })

  it("still sends a file that is merely still processing", () => {
    // The bytes are on disk; only derived metadata is pending.
    expect(
      checkDeliverable({
        channel: "email",
        ...configured,
        asset: { ...asset, status: "PROCESSING" },
      }).allowed,
    ).toBe(true)
  })

  it("enforces each channel's own size ceiling", () => {
    const big = { ...asset, sizeBytes: 10 * 1024 * 1024 }
    // 10 MB is fine for email, too big for a Discord webhook.
    expect(checkDeliverable({ channel: "email", ...configured, asset: big }).allowed).toBe(true)
    expect(checkDeliverable({ channel: "discord", ...configured, asset: big })).toMatchObject({
      code: "FILE_TOO_LARGE",
    })
  })

  it("accepts a file exactly at the limit", () => {
    expect(
      checkDeliverable({
        channel: "discord",
        ...configured,
        asset: { ...asset, sizeBytes: DELIVERY_MAX_BYTES.discord },
      }).allowed,
    ).toBe(true)
  })

  it("handles bigint sizes from Prisma", () => {
    expect(
      checkDeliverable({
        channel: "email",
        ...configured,
        asset: { ...asset, sizeBytes: BigInt(DELIVERY_MAX_BYTES.email + 1) },
      }),
    ).toMatchObject({ code: "FILE_TOO_LARGE" })
  })
})

describe("matchAssetByName", () => {
  const candidates = [
    { id: "1", originalFilename: "report.pdf", title: null },
    { id: "2", originalFilename: "report-final.pdf", title: null },
    { id: "3", originalFilename: "holiday.jpg", title: "Beach sunset" },
  ]

  it("prefers an exact filename over a substring", () => {
    // Without this, "report.pdf" would be ambiguous with "report-final.pdf"
    // and the assistant would refuse a perfectly clear request.
    expect(matchAssetByName("report.pdf", candidates)).toMatchObject({
      status: "matched",
      asset: { id: "1" },
    })
  })

  it("matches on a title too", () => {
    expect(matchAssetByName("Beach sunset", candidates)).toMatchObject({
      status: "matched",
      asset: { id: "3" },
    })
  })

  it("is case and whitespace insensitive", () => {
    expect(matchAssetByName("  HOLIDAY.JPG ", candidates)).toMatchObject({
      status: "matched",
      asset: { id: "3" },
    })
  })

  it("refuses to guess between several substring matches", () => {
    // Sending the wrong file to an inbox is not an action you can take back.
    const result = matchAssetByName("report", candidates)
    expect(result.status).toBe("ambiguous")
    expect(result.status === "ambiguous" && result.candidates).toHaveLength(2)
  })

  it("reports no match rather than picking something close", () => {
    expect(matchAssetByName("invoice", candidates)).toEqual({ status: "none" })
  })

  it("treats an empty query as no match", () => {
    expect(matchAssetByName("   ", candidates)).toEqual({ status: "none" })
  })
})

describe("isValidDiscordWebhookUrl", () => {
  it("accepts a real webhook URL", () => {
    expect(
      isValidDiscordWebhookUrl("https://discord.com/api/webhooks/123456789/abcDEF-_123"),
    ).toBe(true)
    expect(
      isValidDiscordWebhookUrl("https://discord.com/api/v10/webhooks/123456789/abcDEF"),
    ).toBe(true)
  })

  it("refuses a non-Discord host", () => {
    // The webhook URL is posted to with the user's file attached. Accepting an
    // arbitrary host would turn this setting into an exfiltration channel.
    expect(
      isValidDiscordWebhookUrl("https://evil.example.com/api/webhooks/1/abc"),
    ).toBe(false)
    expect(
      isValidDiscordWebhookUrl("https://discord.com.evil.example/api/webhooks/1/abc"),
    ).toBe(false)
  })

  it("refuses plaintext HTTP", () => {
    expect(isValidDiscordWebhookUrl("http://discord.com/api/webhooks/1/abc")).toBe(false)
  })

  it("refuses a Discord URL that is not a webhook endpoint", () => {
    expect(isValidDiscordWebhookUrl("https://discord.com/channels/123/456")).toBe(false)
    expect(isValidDiscordWebhookUrl("https://discord.com/api/webhooks/")).toBe(false)
  })

  it("refuses junk", () => {
    expect(isValidDiscordWebhookUrl("")).toBe(false)
    expect(isValidDiscordWebhookUrl(null)).toBe(false)
    expect(isValidDiscordWebhookUrl("javascript:alert(1)")).toBe(false)
  })
})

describe("destination disclosure", () => {
  it("describes the destination to the model without revealing it", () => {
    expect(describeDestination("email")).toBe("your email")
    expect(describeDestination("discord")).toBe("your Discord")
  })

  it("masks an email address for the user-facing confirmation", () => {
    const masked = maskEmail("roberta@example.com")
    expect(masked).toContain("@example.com")
    expect(masked).not.toContain("roberta")
  })

  it("describes a webhook without exposing its token", () => {
    const description = describeWebhook(
      "https://discord.com/api/webhooks/123456789012/SUPER-SECRET-TOKEN",
    )
    expect(description).not.toContain("SUPER-SECRET-TOKEN")
    expect(description).toContain("…")
  })
})
