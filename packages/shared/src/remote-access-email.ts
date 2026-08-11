/**
 * The "your Arciin address changed" email.
 *
 * Cloudflare quick tunnels get a new hostname every time cloudflared restarts,
 * and the restart usually happens while nobody is watching — a reboot, a crash,
 * a power cut. Until now the only way to learn the new address was to be
 * physically at the server and read it out of Settings, which is precisely
 * impossible in the situation where you need it: you are away from home and the
 * link in your phone has stopped working.
 *
 * So the instance mails it to you instead.
 *
 * Content rules, all of which are security decisions rather than style ones:
 *
 *   - No credentials, no tokens, no session material. The URL is not a secret
 *     in the sense a password is, but it is also not an invitation: reaching
 *     the address still lands on the login screen.
 *   - No storage paths, instance ids, or file names.
 *   - The old address is shown host-only so the reader can confirm the mail is
 *     about their server without it becoming a second live link.
 *
 * Pure: builds strings, sends nothing. Kept out of the API so the wording and
 * escaping are unit-testable without SMTP.
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

const BRAND = {
  background: "#09090B",
  surface: "#18181B",
  muted: "#27272A",
  accent: "#FF4F12",
  text: "#FFFFFF",
  mutedText: "#A1A1AA",
  border: "#3F3F46",
}

/**
 * Escape for HTML text and attribute contexts.
 *
 * The instance name is user-controlled and lands in both. A mail client is a
 * hostile place to discover you did not escape something.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Host of a URL, for display.
 *
 * Falls back to the raw string rather than throwing: an unparseable stored URL
 * must not be the reason the notification fails to send.
 */
export function hostOf(url: string | null | undefined): string {
  const raw = url?.trim()
  if (!raw) return ""
  try {
    return new URL(raw).host
  } catch {
    return raw.replace(/^https?:\/\//i, "").split("/")[0] ?? raw
  }
}

/**
 * Only http(s) links are ever rendered as anchors.
 *
 * The URL comes from cloudflared output and instance settings, not from a
 * request body, but an anchor built from an unvalidated string is a
 * javascript:-injection waiting for the one day that stops being true.
 */
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

export function renderRemoteAccessEmail(input: RemoteAccessEmailInput): RenderedEmail {
  const instanceName = input.instanceName.trim() || "Arciin"
  const safeName = escapeHtml(instanceName)
  const url = input.publicUrl.trim()
  const linkable = isSafeLinkUrl(url)
  const safeUrl = escapeHtml(url)
  const newHost = hostOf(url)
  const previousHost = hostOf(input.previousPublicUrl)
  const localUrl = input.localUrl?.trim() || null
  const localLinkable = isSafeLinkUrl(localUrl)

  const subject = `${instanceName}: new address — ${newHost}`

  const text = [
    `${instanceName} has a new address.`,
    "",
    `  ${url}`,
    "",
    "This one link works on both phone and computer — open it on a phone and you",
    "get the mobile app, open it on a computer and you get the full desktop app.",
    previousHost ? `\nThe old address (${previousHost}) has stopped working.` : "",
    input.changedAt ? `Changed: ${input.changedAt}` : "",
    localUrl ? `\nOn your home network you can also use: ${localUrl}` : "",
    "",
    "You still have to sign in — this link is an address, not a key.",
    "",
    `Sent by your own ${instanceName} server. Nobody else was told.`,
  ]
    .filter((line) => line !== "")
    .join("\n")

  const primaryButton = linkable
    ? `<a href="${safeUrl}" style="display:inline-block;background:${BRAND.accent};color:#FFFFFF;text-decoration:none;font-weight:600;font-size:15px;padding:13px 26px;border-radius:10px;">Open ${safeName}</a>`
    : `<span style="color:${BRAND.mutedText};font-size:14px;">${safeUrl}</span>`

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeName} — new address</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.background};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your new ${safeName} address is ${escapeHtml(newHost)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.background};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <tr><td style="padding:28px 28px 0 28px;">
    <div style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${BRAND.accent};vertical-align:middle;"></div>
    <span style="color:${BRAND.mutedText};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;vertical-align:middle;padding-left:8px;">${safeName}</span>
  </td></tr>

  <tr><td style="padding:18px 28px 0 28px;">
    <h1 style="margin:0;color:${BRAND.text};font-size:22px;line-height:1.3;font-weight:600;">Your server has a new address</h1>
    <p style="margin:10px 0 0 0;color:${BRAND.mutedText};font-size:14px;line-height:1.6;">
      The secure tunnel restarted, so the old link stopped working. This is the current one.
    </p>
  </td></tr>

  <tr><td style="padding:22px 28px 0 28px;">
    <div style="background:${BRAND.muted};border:1px solid ${BRAND.border};border-radius:12px;padding:16px;">
      <div style="color:${BRAND.mutedText};font-size:11px;letter-spacing:0.06em;text-transform:uppercase;">Address</div>
      <div style="color:${BRAND.text};font-size:15px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all;padding-top:6px;">${safeUrl}</div>
    </div>
  </td></tr>

  <tr><td style="padding:20px 28px 0 28px;" align="center">${primaryButton}</td></tr>

  <tr><td style="padding:22px 28px 0 28px;">
    <div style="border:1px solid ${BRAND.border};border-radius:12px;padding:14px 16px;">
      <p style="margin:0;color:${BRAND.text};font-size:13px;line-height:1.6;font-weight:600;">One link, both apps</p>
      <p style="margin:6px 0 0 0;color:${BRAND.mutedText};font-size:13px;line-height:1.6;">
        Open it on your phone and you get the mobile app. Open it on a computer and you get the full desktop app. There is nothing separate to remember.
      </p>
    </div>
  </td></tr>
${
  previousHost
    ? `
  <tr><td style="padding:14px 28px 0 28px;">
    <p style="margin:0;color:${BRAND.mutedText};font-size:12px;line-height:1.6;">
      The previous address (<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(previousHost)}</span>) no longer works. You can delete it from your bookmarks.
    </p>
  </td></tr>`
    : ""
}${
    localUrl
      ? `
  <tr><td style="padding:14px 28px 0 28px;">
    <p style="margin:0;color:${BRAND.mutedText};font-size:12px;line-height:1.6;">
      At home on the same network you can also use ${
        localLinkable
          ? `<a href="${escapeHtml(localUrl)}" style="color:${BRAND.accent};text-decoration:none;">${escapeHtml(hostOf(localUrl))}</a>`
          : `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(localUrl)}</span>`
      }.
    </p>
  </td></tr>`
      : ""
  }
  <tr><td style="padding:22px 28px 26px 28px;">
    <div style="border-top:1px solid ${BRAND.border};padding-top:16px;">
      <p style="margin:0;color:${BRAND.mutedText};font-size:12px;line-height:1.6;">
        You still have to sign in — this link is an address, not a key.
      </p>
      <p style="margin:8px 0 0 0;color:${BRAND.mutedText};font-size:12px;line-height:1.6;">
        Sent by your own ${safeName} server${input.changedAt ? ` at ${escapeHtml(input.changedAt)}` : ""}. Nobody else was told.
      </p>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`

  return { subject, html, text }
}

/** Confirmation mail for the "send a test" button in Settings. */
export function renderEmailTestMessage(instanceName: string): RenderedEmail {
  const name = instanceName.trim() || "Arciin"
  const safeName = escapeHtml(name)

  return {
    subject: `${name}: email is working`,
    text: `Email delivery is configured correctly.\n\n${name} will use this address to send you the new link whenever your server's public address changes.\n`,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:${BRAND.background};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.background};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding:28px;">
  <div style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${BRAND.accent};vertical-align:middle;"></div>
  <span style="color:${BRAND.mutedText};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;vertical-align:middle;padding-left:8px;">${safeName}</span>
  <h1 style="margin:16px 0 0 0;color:${BRAND.text};font-size:20px;font-weight:600;">Email is working</h1>
  <p style="margin:10px 0 0 0;color:${BRAND.mutedText};font-size:14px;line-height:1.6;">
    ${safeName} will use this address to send you the new link whenever your server's public address changes — so you are never locked out just because you are away from home.
  </p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`,
  }
}
