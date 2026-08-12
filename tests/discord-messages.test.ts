import { describe, expect, it } from "vitest"

import {
  ARCIIN_DISCORD_COLOR,
  DISCORD_BANNER_FILENAME,
  DISCORD_MARK_FILENAME,
  discordNamedLink,
  renderDiscordAssetDeliveryMessage,
  renderDiscordRemoteAccessMessage,
  renderDiscordTestMessage,
} from "@arciin/shared"

describe("Discord message embeds", () => {
  it("builds a unique branded test card with Discord-only art refs", () => {
    const msg = renderDiscordTestMessage("Studio")
    expect(msg.username).toBe("Arciin")
    expect(msg.includeBrandArt).toBe(true)
    expect(msg.embeds).toHaveLength(1)
    const embed = msg.embeds[0]!
    expect(embed.color).toBe(ARCIIN_DISCORD_COLOR)
    expect(embed.image?.url).toBe(`attachment://${DISCORD_BANNER_FILENAME}`)
    expect(embed.thumbnail?.url).toBe(`attachment://${DISCORD_MARK_FILENAME}`)
    expect(embed.title).toMatch(/connected/i)
    expect(embed.footer?.text).toMatch(/Arciin/)
    // Must not reuse email asset filenames
    expect(embed.image?.url).not.toContain("email-header")
  })

  it("uses a named open action without dumping the raw URL in the description", () => {
    const msg = renderDiscordRemoteAccessMessage({
      instanceName: "Home Server",
      publicUrl: "https://abc123.trycloudflare.com",
      previousPublicUrl: "https://old.example.com",
    })
    const desc = msg.embeds[0]!.description ?? ""
    expect(desc).toContain(discordNamedLink("Open Home Server", "https://abc123.trycloudflare.com"))
    // No bare URL line as visible text outside the markdown link target
    expect(desc.replace(/\(https?:\/\/[^)]+\)/g, "")).not.toMatch(/https?:\/\/abc123/)
    expect(msg.embeds[0]!.image?.url).toContain(DISCORD_BANNER_FILENAME)
  })

  it("builds asset delivery with banner art", () => {
    const msg = renderDiscordAssetDeliveryMessage({
      instanceName: "Arciin",
      filename: "report.pdf",
      note: "Here you go",
    })
    expect(msg.embeds[0]!.description).toContain("Here you go")
    expect(msg.embeds[0]!.description).toContain("report.pdf")
    expect(msg.embeds[0]!.image?.url).toBe(`attachment://${DISCORD_BANNER_FILENAME}`)
  })
})
