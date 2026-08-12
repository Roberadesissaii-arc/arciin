/**
 * Discord webhook message builders — unique visual identity (not the email template).
 *
 * Discord embeds support attached images via `attachment://filename` when the
 * webhook POST includes those files. Callers attach the Discord-only banner +
 * mark (separate art from email) so every notification looks branded in-channel.
 *
 * Pure: builds JSON payloads, sends nothing.
 */

/** Arciin accent #FF4F12 */
export const ARCIIN_DISCORD_COLOR = 0xff4f12

/** Filenames for Discord-only brand art (must match files attached by the API). */
export const DISCORD_BANNER_FILENAME = "arciin-discord-banner.jpg"
export const DISCORD_MARK_FILENAME = "arciin-discord-mark.png"

export type DiscordEmbedField = {
  name: string
  value: string
  inline?: boolean
}

export type DiscordEmbed = {
  title?: string
  description?: string
  url?: string
  color?: number
  fields?: DiscordEmbedField[]
  footer?: { text: string; icon_url?: string }
  thumbnail?: { url: string }
  image?: { url: string }
  timestamp?: string
  author?: { name: string; icon_url?: string; url?: string }
}

export type DiscordWebhookPayload = {
  username: string
  content?: string
  embeds: DiscordEmbed[]
  allowed_mentions: { parse: string[] }
  /** Always true — API attaches Discord brand files for attachment:// refs. */
  includeBrandArt: true
}

const FOOTER = "Arciin · Your server, your control"

function trim(value: string, max: number): string {
  const t = value.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function discordNamedLink(label: string, url: string): string {
  const safeLabel = label.replace(/[\[\]]/g, "").trim() || "Open"
  return `[**${safeLabel}**](${url.trim()})`
}

function brandChrome(partial: DiscordEmbed): DiscordEmbed {
  const mark = `attachment://${DISCORD_MARK_FILENAME}`
  const banner = `attachment://${DISCORD_BANNER_FILENAME}`
  // Compose without duplicate keys — brand art always applied last.
  return {
    ...partial,
    color: ARCIIN_DISCORD_COLOR,
    timestamp: partial.timestamp ?? new Date().toISOString(),
    author: partial.author ?? { name: "Arciin", icon_url: mark },
    // Discord-only banner + mark (not the email header images).
    image: { url: banner },
    thumbnail: { url: mark },
    footer: { text: FOOTER, icon_url: mark },
  }
}

function wrapPayload(embeds: DiscordEmbed[]): DiscordWebhookPayload {
  return {
    username: "Arciin",
    embeds,
    allowed_mentions: { parse: [] },
    includeBrandArt: true,
  }
}

/** Settings → Discord → Send test */
export function renderDiscordTestMessage(instanceName: string): DiscordWebhookPayload {
  const name = instanceName.trim() || "Arciin"

  return wrapPayload([
    brandChrome({
      title: "You’re connected",
      description: [
        `**${name}** just reached this channel.`,
        "",
        "From now on, important updates from your server land here as branded cards —",
        "with a clear action, not a wall of plain text.",
        "",
        "▸ Public address changes",
        "▸ Files you ask the assistant to send",
        "▸ Quiet confirmations when setup works",
      ].join("\n"),
      fields: [
        {
          name: "Status",
          value: "```diff\n+ Connected\n```",
          inline: true,
        },
        {
          name: "Style",
          value: "Branded · Arciin",
          inline: true,
        },
      ],
    }),
  ])
}

/** Address change / send current link */
export function renderDiscordRemoteAccessMessage(input: {
  instanceName: string
  publicUrl: string
  previousPublicUrl?: string | null
  changedAt?: string | null
}): DiscordWebhookPayload {
  const name = input.instanceName.trim() || "Arciin"
  const url = input.publicUrl.trim()
  const openLabel = `Open ${name}`

  const lines = [
    "Your secure tunnel restarted, so the old bookmark no longer works.",
    "",
    "### Open your server",
    discordNamedLink(openLabel, url),
    "",
    "_Same action on phone and computer — sign in as usual._",
  ]

  if (input.previousPublicUrl?.trim()) {
    lines.push("", "The previous bookmark can be removed.")
  }
  if (input.changedAt?.trim()) {
    lines.push(`Updated · ${input.changedAt.trim()}`)
  }

  return wrapPayload([
    brandChrome({
      title: "New address ready",
      description: lines.join("\n"),
      // Title area also links when clicked (no URL shown as text).
      url: url.startsWith("http") ? url : undefined,
    }),
  ])
}

/** Chat file delivery */
export function renderDiscordAssetDeliveryMessage(input: {
  instanceName: string
  filename: string
  note?: string | null
}): DiscordWebhookPayload {
  const name = input.instanceName.trim() || "Arciin"
  const file = trim(input.filename, 180)
  const note = input.note?.trim()

  return wrapPayload([
    brandChrome({
      title: "File from your library",
      description: [
        note ? trim(note, 1200) : `**${name}** sent a file to this channel.`,
        "",
        `**${file}**`,
        "",
        "_Download the attachment on this message._",
      ].join("\n"),
    }),
  ])
}
