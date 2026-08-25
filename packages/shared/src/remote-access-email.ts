/**
 * Arciin transactional email templates.
 *
 * Light, modern product mail (not a dark dump). Full-width header image +
 * compact brand mark are always CID-attached by the API so every message looks
 * the same in every inbox.
 *
 * Links: never show the raw URL in HTML. Only a friendly named button; the
 * destination is the href. Plain-text part still includes the URL for clients
 * that strip HTML.
 */

export type RemoteAccessEmailInput = {
  instanceName: string
  /** The new public address. One domain now serves desktop and mobile. */
  publicUrl: string
  previousPublicUrl?: string | null
  /** Formatted by the caller so this module stays free of locale concerns. */
  changedAt?: string | null
  /** Local address, shown as the fallback for when the reader is home. */
  localUrl?: string | null
}

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

/** Full-width masthead banner (generated brand art). */
export const ARCIIN_EMAIL_HEADER_CID = "arciin-header"

/** Small square mark used next to the wordmark in the footer strip. */
export const ARCIIN_EMAIL_BRAND_CID = "arciin-brand"

/** @deprecated use ARCIIN_EMAIL_HEADER_CID / ARCIIN_EMAIL_BRAND_CID */
export const ARCIIN_EMAIL_BRAND_CID_LEGACY = ARCIIN_EMAIL_BRAND_CID

/**
 * Escape for HTML text and attribute contexts.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function hostOf(url: string | null | undefined): string {
  const raw = url?.trim()
  if (!raw) return ""
  try {
    return new URL(raw).host
  } catch {
    return raw.replace(/^https?:\/\//i, "").split("/")[0] ?? raw
  }
}

export function isSafeLinkUrl(url: string | null | undefined): boolean {
  const raw = url?.trim()
  if (!raw) return false
  try {
    const parsed = new URL(raw)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
  } catch {
    return false
  }
}

type ShellInput = {
  title: string
  heading: string
  subheading: string
  bodyHtml: string
  preheader: string
  footerNote: string
  badge?: string | null
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** Light product palette — modern SaaS mail, not black. */
const C = {
  page: "#F4F4F5",
  card: "#FFFFFF",
  border: "#E4E4E7",
  borderSoft: "#F4F4F5",
  text: "#18181B",
  muted: "#52525B",
  dim: "#71717A",
  accent: "#FF4F12",
  accentSoft: "#FFF4F0",
  white: "#FFFFFF",
  panel: "#FAFAFA",
} as const

function shell(input: ShellInput): string {
  const badge = input.badge?.trim()
    ? `<div style="padding-top:14px;">
        <span style="display:inline-block;padding:6px 12px;border-radius:999px;background:${C.accentSoft};border:1px solid rgba(255,79,18,0.22);font-family:${FONT};font-size:11px;font-weight:650;letter-spacing:0.04em;text-transform:uppercase;color:${C.accent};">${escapeHtml(input.badge.trim())}</span>
      </div>`
    : ""

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${input.title}</title>
<style>
  a { text-decoration: none !important; }
  @media only screen and (max-width:600px) {
    .pad  { padding-left:20px !important; padding-right:20px !important; }
    .h1   { font-size:22px !important; }
    .stack { display:block !important; width:100% !important; }
    .hero { height:auto !important; max-height:160px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${input.preheader}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:32px 12px 28px 12px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${C.card};border:1px solid ${C.border};border-radius:20px;overflow:hidden;font-family:${FONT};box-shadow:0 8px 30px rgba(24,24,27,0.06);">

  <!-- Generated brand header image (cid:arciin-header) -->
  <tr><td style="padding:0;line-height:0;font-size:0;">
    <img class="hero" src="cid:${ARCIIN_EMAIL_HEADER_CID}" width="560" alt="Arciin" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;text-decoration:none;" />
  </td></tr>

  <tr><td class="pad" style="padding:28px 28px 0 28px;">
    <h1 class="h1" style="margin:0;font-family:${FONT};font-size:24px;line-height:1.28;font-weight:650;letter-spacing:-0.025em;color:${C.text};">${input.heading}</h1>
    <p style="margin:12px 0 0 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${C.muted};">${input.subheading}</p>
    ${badge}
  </td></tr>

  ${input.bodyHtml}

  <tr><td class="pad" style="padding:8px 28px 28px 28px;">
    <div style="border-top:1px solid ${C.borderSoft};padding-top:18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="vertical-align:middle;width:32px;">
          <img src="cid:${ARCIIN_EMAIL_BRAND_CID}" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border-radius:8px;border:1px solid ${C.border};" />
        </td>
        <td style="padding-left:10px;vertical-align:middle;">
          <div style="font-family:${FONT};font-size:12px;font-weight:600;color:${C.text};">Arciin</div>
          <div style="font-family:${FONT};font-size:11px;line-height:1.45;color:${C.dim};">${input.footerNote}</div>
        </td>
      </tr></table>
    </div>
  </td></tr>

</table>

<p style="max-width:560px;margin:16px auto 0 auto;font-family:${FONT};font-size:11px;line-height:1.6;color:${C.dim};text-align:center;">
  Sent by your own Arciin server · no third-party marketing platform
</p>

</td></tr>
</table>
</body>
</html>`
}

/**
 * Named CTA only — never put the raw URL in the visible label.
 * Full-width of the content column (not a floating centered pill).
 */
function primaryButton(href: string, label: string): string {
  if (!isSafeLinkUrl(href)) return ""
  const safeHref = escapeHtml(href.trim())
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="center" bgcolor="${C.accent}" style="border-radius:12px;">
      <a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="display:block;width:100%;padding:15px 20px;font-family:${FONT};font-size:15px;font-weight:650;letter-spacing:-0.01em;color:${C.white};border-radius:12px;text-decoration:none;text-align:center;box-sizing:border-box;">${escapeHtml(label)}</a>
    </td>
  </tr></table>`
}

/** Simple icon chip (email-safe: table cell, no external images). */
function iconChip(kind: "phone" | "computer"): string {
  // Unicode glyphs render in nearly every client; chip gives them structure.
  const glyph = kind === "phone" ? "&#128241;" : "&#128187;"
  const label = kind === "phone" ? "Phone" : "Desktop"
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" aria-label="${label}"><tr>
    <td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;border-radius:10px;background:${C.accentSoft};border:1px solid rgba(255,79,18,0.18);font-size:18px;line-height:40px;text-align:center;">${glyph}</td>
  </tr></table>`
}

/** Full-width info row with icon + title + caption (stacked, spaced). */
function featureRow(kind: "phone" | "computer", title: string, caption: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border:1px solid ${C.border};border-radius:12px;">
  <tr>
    <td width="40" valign="middle" style="padding:14px 0 14px 14px;width:40px;">${iconChip(kind)}</td>
    <td valign="middle" style="padding:14px 16px 14px 12px;">
      <div style="font-family:${FONT};font-size:13px;font-weight:650;color:${C.text};">${escapeHtml(title)}</div>
      <div style="padding-top:3px;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.dim};">${escapeHtml(caption)}</div>
    </td>
  </tr>
</table>`
}

export function renderRemoteAccessEmail(input: RemoteAccessEmailInput): RenderedEmail {
  const instanceName = input.instanceName.trim() || "Arciin"
  const safeName = escapeHtml(instanceName)
  const url = input.publicUrl.trim()
  const previousHost = hostOf(input.previousPublicUrl)
  const localUrl = input.localUrl?.trim() || null
  const localHost = hostOf(localUrl)
  const buttonLabel = `Open ${instanceName}`

  // Plain text still includes the URL — many clients strip HTML entirely.
  const text = [
    `${instanceName} has a new address.`,
    "",
    `Open: ${buttonLabel}`,
    url,
    "",
    "One link for phone and computer.",
    previousHost ? `The old address (${previousHost}) has stopped working.` : "",
    input.changedAt ? `Changed: ${input.changedAt}` : "",
    localUrl ? `At home on the same network: ${localUrl}` : "",
    "",
    "You still have to sign in — this is an address, not a key.",
  ]
    .filter((line) => line !== "")
    .join("\n")

  // HTML: NO raw URL shown. Full-width named button; stacked device rows with icons.
  const bodyHtml = `
  <tr><td class="pad" style="padding:22px 28px 0 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border:1px solid ${C.border};border-radius:14px;">
      <tr><td style="padding:16px 18px;">
        <div style="font-family:${FONT};font-size:13px;font-weight:600;color:${C.text};">What this is</div>
        <div style="padding-top:6px;font-family:${FONT};font-size:13px;line-height:1.65;color:${C.muted};">
          Your secure tunnel restarted, so the previous bookmark stopped working.
          Use the button below — works on phone and computer.
        </div>
      </td></tr>
    </table>
  </td></tr>

  <tr><td class="pad" style="padding:20px 28px 0 28px;">
    ${primaryButton(url, buttonLabel)}
  </td></tr>

  <tr><td class="pad" style="padding:20px 28px 0 28px;">
    ${featureRow("phone", "On your phone", "Opens the mobile app")}
  </td></tr>
  <tr><td class="pad" style="padding:12px 28px 0 28px;">
    ${featureRow("computer", "On a computer", "Opens the full desktop app")}
  </td></tr>
${
  previousHost || localHost
    ? `  <tr><td class="pad" style="padding:16px 28px 0 28px;">
    ${
      previousHost
        ? `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.65;color:${C.dim};">Your previous bookmark no longer works — remove it when you can.</p>`
        : ""
    }${
      localHost
        ? `<p style="margin:${previousHost ? "8px" : "0"} 0 0 0;font-family:${FONT};font-size:12px;line-height:1.65;color:${C.dim};">At home on the same network you can also open Arciin from your local network.</p>`
        : ""
    }
  </td></tr>`
    : ""
}
  <tr><td class="pad" style="padding:22px 28px 0 28px;">&nbsp;</td></tr>`

  return {
    subject: `${instanceName}: new address ready`,
    html: shell({
      title: `${safeName} — new address`,
      heading: "Your server has a new address",
      subheading: "The secure tunnel restarted. Open your instance with the button below.",
      preheader: `Open ${escapeHtml(instanceName)} — new address ready`,
      footerNote: `You still sign in as usual.${input.changedAt ? ` Updated ${escapeHtml(input.changedAt)}.` : ""}`,
      bodyHtml,
      badge: "Remote access",
    }),
    text,
  }
}

/** Confirmation mail for Settings → Email → Send test. */
export function renderEmailTestMessage(instanceName: string): RenderedEmail {
  const name = instanceName.trim() || "Arciin"
  const safeName = escapeHtml(name)

  return {
    subject: `${name}: email is working`,
    text: [
      `Email delivery is configured correctly for ${name}.`,
      "",
      "When your server's public address changes, you will get a message like this",
      "with a button to open Arciin — no copy-pasting raw links.",
      "",
      "— Arciin",
    ].join("\n"),
    html: shell({
      title: `${safeName} — email is working`,
      heading: "Email is working",
      subheading: `${safeName} can reach this inbox. Delivery looks good.`,
      preheader: "Delivery confirmed — Arciin can reach this address",
      badge: "Connected",
      footerNote: "You will get the same branded style whenever your address changes.",
      bodyHtml: `
  <tr><td class="pad" style="padding:24px 28px 0 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border:1px solid ${C.border};border-radius:14px;">
      <tr><td style="padding:18px;">
        <div style="font-family:${FONT};font-size:13px;font-weight:600;color:${C.text};">What happens next</div>
        <div style="padding-top:8px;font-family:${FONT};font-size:13px;line-height:1.65;color:${C.muted};">
          If the secure tunnel restarts, you will receive a short message here with a button named after your instance — for example <strong style="color:${C.text};">Open ${safeName}</strong>. Tap it to continue; no raw link to decipher.
        </div>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:18px 28px 0 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:0 0 10px 0;font-family:${FONT};font-size:13px;color:${C.muted};">
        <span style="color:${C.accent};font-weight:700;">●</span>&nbsp;&nbsp;Brand header on every message
      </td></tr>
      <tr><td style="padding:0 0 10px 0;font-family:${FONT};font-size:13px;color:${C.muted};">
        <span style="color:${C.accent};font-weight:700;">●</span>&nbsp;&nbsp;Friendly button names — not raw URLs
      </td></tr>
      <tr><td style="font-family:${FONT};font-size:13px;color:${C.muted};">
        <span style="color:${C.accent};font-weight:700;">●</span>&nbsp;&nbsp;Sent only from your own server
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:22px 28px 0 28px;">&nbsp;</td></tr>`,
    }),
  }
}

function formatEmailBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Human title from a storage filename — drop long junk tails like (z-lib.org).pdf
 * while keeping a readable book/document name.
 */
export function displayNameFromFilename(filename: string): string {
  let name = filename.trim()
  // Strip extension for display
  name = name.replace(/\.[a-z0-9]{1,8}$/i, "")
  // Drop common download-site / mirror noise in parentheses
  name = name
    .replace(/\s*\((?:z-?lib(?:\.org)?|libgen|pdfdrive|ebook|epub|complete|full)[^)]*\)\s*/gi, " ")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
  return name || filename.trim()
}

/** Extension label for a quiet meta line (e.g. pdf · 1.4 MB) — not a big chip. */
function extensionLabel(filename: string): string | null {
  const m = filename.trim().match(/\.([a-z0-9]{1,8})$/i)
  return m ? m[1]!.toLowerCase() : null
}

/** Clean attachment block — name first, no type icon chip, no orange side bar. */
function attachmentCard(input: {
  filename: string
  mimeType?: string | null
  sizeBytes?: number | null
}): string {
  const title = displayNameFromFilename(input.filename)
  const safeTitle = escapeHtml(title)
  const ext = extensionLabel(input.filename)
  const size = formatEmailBytes(input.sizeBytes ?? null)
  const metaParts = [ext, size].filter(Boolean) as string[]
  const meta = metaParts.join(" · ")

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border:1px solid ${C.border};border-radius:14px;">
  <tr>
    <td style="padding:18px 20px;">
      <div style="font-family:${FONT};font-size:10px;font-weight:650;letter-spacing:0.1em;text-transform:uppercase;color:${C.dim};">Attached file</div>
      <div style="padding-top:8px;font-family:${FONT};font-size:16px;font-weight:650;letter-spacing:-0.02em;color:${C.text};word-break:break-word;line-height:1.4;">${safeTitle}</div>
      ${
        meta
          ? `<div style="padding-top:6px;font-family:${FONT};font-size:12px;line-height:1.45;color:${C.muted};">${escapeHtml(meta)}</div>`
          : ""
      }
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid ${C.borderSoft};font-family:${FONT};font-size:12px;line-height:1.55;color:${C.dim};">
        Download it from your email client’s attachment area below.
      </div>
    </td>
  </tr>
</table>`
}

/** File delivery mail (chat “send this to my email”). */
export function renderAssetDeliveryEmail(input: {
  instanceName: string
  filename: string
  note?: string | null
  mimeType?: string | null
  sizeBytes?: number | null
}): RenderedEmail {
  const name = input.instanceName.trim() || "Arciin"
  const safeName = escapeHtml(name)
  const display = displayNameFromFilename(input.filename)
  const note = input.note?.trim() || null
  const size = formatEmailBytes(input.sizeBytes ?? null)

  return {
    subject: `${name}: ${display}`,
    text: [
      note || `${name} sent you a file.`,
      "",
      `Attached: ${display}${size ? ` (${size})` : ""}`,
      input.filename !== display ? `File: ${input.filename}` : "",
      "",
      "Download the file from this email’s attachments.",
      "",
      "— Arciin",
    ]
      .filter((line) => line !== "")
      .join("\n"),
    html: shell({
      title: `${safeName} — file delivery`,
      heading: "Your file is ready",
      subheading: note
        ? escapeHtml(note)
        : `${safeName} delivered a file from your library to this inbox.`,
      preheader: `${escapeHtml(display)} is attached`,
      badge: "Library delivery",
      footerNote: "Sent from your Arciin instance at your request.",
      bodyHtml: `
  <tr><td class="pad" style="padding:24px 28px 0 28px;">
    ${attachmentCard({
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    })}
  </td></tr>
  <tr><td class="pad" style="padding:22px 28px 0 28px;">&nbsp;</td></tr>`,
    }),
  }
}
