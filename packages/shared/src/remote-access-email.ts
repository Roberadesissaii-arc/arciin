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

/**
 * Shared chrome for both messages.
 *
 * Email is not the app. The first version used the product's dark palette,
 * which arrives in a light inbox as a black slab with a floating card in it —
 * it reads as broken rather than branded. So: a light card on a light page,
 * the orange kept only as an accent, and a `prefers-color-scheme` block for
 * clients that support it (Apple Mail, iOS) while everyone else gets the light
 * version that works everywhere.
 *
 * Everything is inline styles on tables. Gmail strips `<head>` styles in
 * forwarded mail and ignores most modern CSS, so the layout cannot depend on
 * anything but width attributes and inline rules.
 */
function shell(input: {
  title: string
  eyebrow: string
  heading: string
  bodyHtml: string
  preheader: string
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${input.title}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .arciin-page { background:#09090B !important; }
    .arciin-card { background:#18181B !important; border-color:#3F3F46 !important; }
    .arciin-heading, .arciin-strong { color:#FFFFFF !important; }
    .arciin-text { color:#A1A1AA !important; }
    .arciin-panel { background:#27272A !important; border-color:#3F3F46 !important; }
  }
  @media only screen and (max-width:600px) {
    .arciin-pad { padding-left:20px !important; padding-right:20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#F4F4F5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${input.preheader}</div>
<table role="presentation" class="arciin-page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F4F5;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" class="arciin-card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:14px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <tr><td class="arciin-pad" style="padding:28px 28px 0 28px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:8px;"><div style="width:8px;height:8px;border-radius:4px;background:#FF4F12;font-size:0;line-height:0;">&nbsp;</div></td>
      <td class="arciin-text" style="font-size:11px;letter-spacing:0.09em;text-transform:uppercase;color:#71717A;">${input.eyebrow}</td>
    </tr></table>
    <h1 class="arciin-heading" style="margin:16px 0 0 0;color:#18181B;font-size:21px;line-height:1.3;font-weight:600;">${input.heading}</h1>
  </td></tr>
  ${input.bodyHtml}
</table>
</td></tr>
</table>
</body>
</html>`
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

  // A bulletproof-ish button: a padded anchor inside a table cell, which is
  // the only construction Outlook and Gmail both render the same way.
  const button = linkable
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="#FF4F12" style="border-radius:9px;">
          <a href="${safeUrl}" style="display:inline-block;padding:13px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:9px;">Open ${safeName}</a>
        </td></tr></table>`
    : ""

  const bodyHtml = `
  <tr><td class="arciin-pad" style="padding:10px 28px 0 28px;">
    <p class="arciin-text" style="margin:0;color:#52525B;font-size:14px;line-height:1.6;">
      The secure tunnel restarted, so the old link stopped working. This is the current one.
    </p>
  </td></tr>

  <tr><td class="arciin-pad" style="padding:20px 28px 0 28px;">
    <table role="presentation" class="arciin-panel" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAFA;border:1px solid #E4E4E7;border-radius:10px;">
      <tr><td style="padding:14px 16px;">
        <div class="arciin-text" style="color:#71717A;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;">Address</div>
        <div class="arciin-strong" style="color:#18181B;font-size:14px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;padding-top:6px;">${safeUrl}</div>
      </td></tr>
    </table>
  </td></tr>

  ${button ? `<tr><td class="arciin-pad" align="center" style="padding:20px 28px 0 28px;">${button}</td></tr>` : ""}

  <tr><td class="arciin-pad" style="padding:22px 28px 0 28px;">
    <p class="arciin-strong" style="margin:0;color:#18181B;font-size:13px;font-weight:600;">One link, both apps</p>
    <p class="arciin-text" style="margin:6px 0 0 0;color:#52525B;font-size:13px;line-height:1.6;">
      Open it on your phone and you get the mobile app. On a computer you get the full desktop app. There is nothing separate to remember.
    </p>
  </td></tr>
${
  previousHost
    ? `  <tr><td class="arciin-pad" style="padding:14px 28px 0 28px;">
    <p class="arciin-text" style="margin:0;color:#71717A;font-size:12px;line-height:1.6;">
      The previous address (<span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escapeHtml(previousHost)}</span>) no longer works — you can delete it from your bookmarks.
    </p>
  </td></tr>`
    : ""
}${
    localUrl
      ? `  <tr><td class="arciin-pad" style="padding:14px 28px 0 28px;">
    <p class="arciin-text" style="margin:0;color:#71717A;font-size:12px;line-height:1.6;">
      At home on the same network you can also use <span style="font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${escapeHtml(hostOf(localUrl))}</span>.
    </p>
  </td></tr>`
      : ""
  }
  <tr><td class="arciin-pad" style="padding:22px 28px 26px 28px;">
    <div style="border-top:1px solid #E4E4E7;padding-top:16px;">
      <p class="arciin-text" style="margin:0;color:#71717A;font-size:12px;line-height:1.6;">
        You still have to sign in — this link is an address, not a key.
      </p>
      <p class="arciin-text" style="margin:8px 0 0 0;color:#A1A1AA;font-size:12px;line-height:1.6;">
        Sent by your own ${safeName} server${input.changedAt ? ` at ${escapeHtml(input.changedAt)}` : ""}. Nobody else was told.
      </p>
    </div>
  </td></tr>`

  return {
    subject,
    html: shell({
      title: `${safeName} — new address`,
      eyebrow: safeName,
      heading: "Your server has a new address",
      preheader: `Your new ${safeName} address is ${escapeHtml(newHost)}`,
      bodyHtml,
    }),
    text,
  }
}

/** Confirmation mail for the "send a test" button in Settings. */
export function renderEmailTestMessage(instanceName: string): RenderedEmail {
  const name = instanceName.trim() || "Arciin"
  const safeName = escapeHtml(name)

  return {
    subject: `${name}: email is working`,
    text: `Email delivery is configured correctly.\n\n${name} will use this address to send you the new link whenever your server's public address changes, so you are never locked out because you are away from home.\n`,
    html: shell({
      title: `${safeName} — email is working`,
      eyebrow: safeName,
      heading: "Email is working",
      preheader: `${safeName} can reach this address`,
      bodyHtml: `
  <tr><td class="arciin-pad" style="padding:10px 28px 0 28px;">
    <p class="arciin-text" style="margin:0;color:#52525B;font-size:14px;line-height:1.6;">
      ${safeName} will use this address to send you the new link whenever your server's public address changes — so you are never locked out just because you are away from home.
    </p>
  </td></tr>
  <tr><td class="arciin-pad" style="padding:22px 28px 26px 28px;">
    <div style="border-top:1px solid #E4E4E7;padding-top:16px;">
      <p class="arciin-text" style="margin:0;color:#A1A1AA;font-size:12px;line-height:1.6;">
        Sent by your own ${safeName} server. Nothing left this machine except this message.
      </p>
    </div>
  </td></tr>`,
    }),
  }
}
