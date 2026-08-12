import { describe, expect, it } from "vitest"

import {
  ARCIIN_EMAIL_BRAND_CID,
  ARCIIN_EMAIL_HEADER_CID,
  hostOf,
  isSafeLinkUrl,
  renderAssetDeliveryEmail,
  renderEmailTestMessage,
  renderRemoteAccessEmail,
} from "@arciin/shared"

describe("Arciin email templates", () => {
  it("embeds generated header + brand CIDs on the light test mail", () => {
    const test = renderEmailTestMessage("Studio")
    expect(test.html).toContain(`cid:${ARCIIN_EMAIL_HEADER_CID}`)
    expect(test.html).toContain(`cid:${ARCIIN_EMAIL_BRAND_CID}`)
    expect(test.html).toContain("#F4F4F5")
    expect(test.html).toContain("#FFFFFF")
    expect(test.html).toContain("#FF4F12")
    // Not the previous dark dump
    expect(test.html).not.toContain("#09090B")
    expect(test.subject).toMatch(/email is working/i)
  })

  it("shows a named button only — no raw URL text in the HTML body", () => {
    const mail = renderRemoteAccessEmail({
      instanceName: "Home Server",
      publicUrl: "https://abc123.trycloudflare.com",
      previousPublicUrl: "https://old.trycloudflare.com",
      localUrl: "http://192.168.1.10:3002",
    })

    expect(mail.html).toContain(`cid:${ARCIIN_EMAIL_HEADER_CID}`)
    expect(mail.html).toContain("Open Home Server")
    // Button carries the href, label is a friendly name only
    expect(mail.html).toMatch(
      /<a href="https:\/\/abc123\.trycloudflare\.com"[^>]*>Open Home Server<\/a>/,
    )
    // Visible text nodes must not dump the raw URL (href attribute is fine)
    const withoutHrefs = mail.html.replace(/\shref="[^"]*"/gi, "")
    expect(withoutHrefs).not.toMatch(/https?:\/\/abc123\.trycloudflare\.com/i)
    expect(withoutHrefs).not.toContain("abc123.trycloudflare.com")
    // Plain text still has the URL for clients without HTML
    expect(mail.text).toContain("https://abc123.trycloudflare.com")
  })

  it("rejects unsafe javascript: links", () => {
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeLinkUrl("https://example.com")).toBe(true)
    expect(hostOf("https://mail.example.com/path")).toBe("mail.example.com")
  })

  it("renders file delivery with a clean name (no type chip / orange bar)", () => {
    const mail = renderAssetDeliveryEmail({
      instanceName: "Arciin",
      filename: "101 Essays That Will Change the Way You Think (Brianna Wiest) (z-lib.org).pdf",
      note: "As requested",
      mimeType: "application/pdf",
      sizeBytes: 1_500_000,
    })
    expect(mail.html).toContain(`cid:${ARCIIN_EMAIL_HEADER_CID}`)
    expect(mail.html).toContain("Attached file")
    expect(mail.html).toContain("As requested")
    // Friendly title — not the raw junk filename with (z-lib.org).pdf
    expect(mail.html).toContain("101 Essays That Will Change the Way You Think (Brianna Wiest)")
    expect(mail.html).not.toContain("z-lib.org")
    // No big PDF chip box
    expect(mail.html).not.toMatch(/>\s*PDF\s*</)
    // No orange left accent bar cell
    expect(mail.html).not.toMatch(/width="4"[^>]*background:#FF4F12/)
    expect(mail.html).toMatch(/pdf · /i)
    expect(mail.subject).toContain("101 Essays That Will Change the Way You Think")
  })
})
