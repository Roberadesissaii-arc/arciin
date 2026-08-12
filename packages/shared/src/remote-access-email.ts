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
 * Designed as mail, not as a screenshot of the app. Three things carry it:
 *
 *   1. **A masthead**, so the message is identifiable in a crowded inbox before
 *      the reader has read a word.
 *   2. **One obvious action.** Transactional mail exists to be acted on; every
 *      element that is not the address or the button is deliberately quieter.
 *   3. **Generous vertical rhythm.** Inbox chrome already crowds the message,
 *      so the padding has to be larger than it would be on a web page.
 *
 * Constraints that shape the markup: tables, not flex or grid; inline styles,
 * because Gmail strips `<head>` CSS on forward; a padded anchor inside a
 * `bgcolor` cell for the button, because that is the one construction Gmail
 * and Outlook agree on; and no external images, so nothing depends on remote
 * content being unblocked.
 */
type ShellInput = {
  title: string
  heading: string
  subheading: string
  bodyHtml: string
  preheader: string
  footerNote: string
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"

function shell(input: ShellInput): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${input.title}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .page      { background:#0B0B0E !important; }
    .card      { background:#161619 !important; border-color:#2A2A30 !important; }
    .masthead  { background:#101013 !important; border-color:#2A2A30 !important; }
    .h1, .strong, .wordmark { color:#FAFAFA !important; }
    .body-text { color:#A1A1AA !important; }
    .small     { color:#8B8B93 !important; }
    .panel     { background:#101013 !important; border-color:#2A2A30 !important; }
    .rule      { border-color:#2A2A30 !important; }
    .pill      { background:#101013 !important; border-color:#2A2A30 !important; }
  }
  @media only screen and (max-width:600px) {
    .pad  { padding-left:22px !important; padding-right:22px !important; }
    .h1   { font-size:22px !important; }
    .stack { display:block !important; width:100% !important; }
  }
  a { text-decoration:none; }
</style>
</head>
<body style="margin:0;padding:0;background:#F5F5F7;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${input.preheader}</div>

<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F5F7;">
<tr><td align="center" style="padding:40px 12px;">

<table role="presentation" class="card" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:544px;background:#FFFFFF;border:1px solid #E6E6EA;border-radius:16px;overflow:hidden;font-family:${FONT};">

  <!-- Masthead: identifiable at a glance, before a word is read. -->
  <tr><td class="masthead pad" style="background:#FBFBFC;border-bottom:1px solid #E6E6EA;padding:18px 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="padding-right:9px;vertical-align:middle;">
        <div style="width:9px;height:9px;border-radius:5px;background:#FF4F12;font-size:0;line-height:0;">&nbsp;</div>
      </td>
      <td class="wordmark" style="vertical-align:middle;font-family:${FONT};font-size:14px;font-weight:600;letter-spacing:-0.01em;color:#18181B;">Arciin</td>
    </tr></table>
  </td></tr>

  <tr><td class="pad" style="padding:36px 32px 0 32px;">
    <h1 class="h1" style="margin:0;font-family:${FONT};font-size:25px;line-height:1.25;font-weight:650;letter-spacing:-0.02em;color:#0F0F12;">${input.heading}</h1>
    <p class="body-text" style="margin:12px 0 0 0;font-family:${FONT};font-size:15px;line-height:1.62;color:#52525B;">${input.subheading}</p>
  </td></tr>

  ${input.bodyHtml}

  <tr><td class="pad" style="padding:0 32px 32px 32px;">
    <div class="rule" style="border-top:1px solid #EDEDF0;padding-top:20px;">
      <p class="small" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.65;color:#8E8E96;">${input.footerNote}</p>
    </div>
  </td></tr>

</table>

<p class="small" style="max-width:544px;margin:18px auto 0 auto;font-family:${FONT};font-size:11px;line-height:1.6;color:#9A9AA2;text-align:center;">
  Sent by your own Arciin server. No third party was involved in delivering this.
</p>

</td></tr>
</table>
</body>
</html>`
}

/** The call to action. A padded anchor in a bgcolor cell renders everywhere. */
function primaryButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
    <td align="center" bgcolor="#FF4F12" style="border-radius:10px;">
      <a href="${href}" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:15px;font-weight:600;letter-spacing:-0.01em;color:#FFFFFF;border-radius:10px;">${label}</a>
    </td>
  </tr></table>`
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

  const text = [
    `${instanceName} has a new address.`,
    "",
    `  ${url}`,
    "",
    "One link for both: open it on a phone and you get the mobile app, on a",
    "computer you get the full desktop app.",
    previousHost ? `\nThe old address (${previousHost}) has stopped working.` : "",
    input.changedAt ? `Changed: ${input.changedAt}` : "",
    localUrl ? `\nAt home on the same network: ${localUrl}` : "",
    "",
    "You still have to sign in — this link is an address, not a key.",
  ]
    .filter((line) => line !== "")
    .join("\n")

  const bodyHtml = `
  <!-- The address itself: the one thing the reader came for. -->
  <tr><td class="pad" style="padding:26px 32px 0 32px;">
    <table role="presentation" class="panel" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAFB;border:1px solid #E6E6EA;border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <div class="small" style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#8E8E96;">Your address</div>
        <div class="strong" style="padding-top:7px;font-family:${MONO};font-size:14px;line-height:1.5;color:#0F0F12;word-break:break-all;">${safeUrl}</div>
      </td></tr>
    </table>
  </td></tr>

  ${
    linkable
      ? `<tr><td class="pad" align="center" style="padding:24px 32px 0 32px;">${primaryButton(safeUrl, "Open " + safeName)}</td></tr>`
      : ""
  }

  <!-- Two quiet cells: visual rhythm, and the one thing people ask about. -->
  <tr><td class="pad" style="padding:28px 32px 0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="stack pill" width="50%" style="background:#FAFAFB;border:1px solid #E6E6EA;border-radius:10px;padding:14px 16px;vertical-align:top;">
        <div class="strong" style="font-family:${FONT};font-size:13px;font-weight:600;color:#0F0F12;">On your phone</div>
        <div class="small" style="padding-top:3px;font-family:${FONT};font-size:12px;line-height:1.55;color:#8E8E96;">Opens the mobile app</div>
      </td>
      <td class="stack" width="12" style="font-size:0;line-height:0;">&nbsp;</td>
      <td class="stack pill" width="50%" style="background:#FAFAFB;border:1px solid #E6E6EA;border-radius:10px;padding:14px 16px;vertical-align:top;">
        <div class="strong" style="font-family:${FONT};font-size:13px;font-weight:600;color:#0F0F12;">On a computer</div>
        <div class="small" style="padding-top:3px;font-family:${FONT};font-size:12px;line-height:1.55;color:#8E8E96;">Opens the full desktop app</div>
      </td>
    </tr></table>
  </td></tr>
${
  previousHost || localUrl
    ? `  <tr><td class="pad" style="padding:22px 32px 0 32px;">
    ${
      previousHost
        ? `<p class="small" style="margin:0;font-family:${FONT};font-size:12px;line-height:1.65;color:#8E8E96;">The previous address <span style="font-family:${MONO};">${escapeHtml(previousHost)}</span> no longer works — safe to remove from your bookmarks.</p>`
        : ""
    }${
        localUrl
          ? `<p class="small" style="margin:${previousHost ? "8px" : "0"} 0 0 0;font-family:${FONT};font-size:12px;line-height:1.65;color:#8E8E96;">At home on the same network you can also use <span style="font-family:${MONO};">${escapeHtml(hostOf(localUrl))}</span>.</p>`
          : ""
      }
  </td></tr>`
    : ""
}
  <tr><td class="pad" style="padding:26px 32px 0 32px;">&nbsp;</td></tr>`

  return {
    subject: `${instanceName}: new address — ${newHost}`,
    html: shell({
      title: `${safeName} — new address`,
      heading: "Your server has a new address",
      subheading:
        "The secure tunnel restarted, so the previous link stopped working. This is the current one.",
      preheader: `${escapeHtml(newHost)} — one link for phone and computer`,
      footerNote: `You still have to sign in; this link is an address, not a key.${input.changedAt ? ` Changed ${escapeHtml(input.changedAt)}.` : ""}`,
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
    text: `Email delivery is configured correctly.\n\n${name} will send the new link to this address whenever your server's public address changes, so you are never locked out because you are away from home.\n`,
    html: shell({
      title: `${safeName} — email is working`,
      heading: "Email is working",
      subheading: `${safeName} can reach this address. Nothing else to set up.`,
      preheader: "Delivery confirmed — you will get the new link automatically",
      footerNote:
        "You will receive one of these whenever your server's public address changes.",
      bodyHtml: `
  <tr><td class="pad" style="padding:26px 32px 0 32px;">
    <table role="presentation" class="panel" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FAFAFB;border:1px solid #E6E6EA;border-radius:12px;">
      <tr><td style="padding:18px;">
        <div class="strong" style="font-family:${FONT};font-size:13px;font-weight:600;color:#0F0F12;">What happens next</div>
        <div class="small" style="padding-top:6px;font-family:${FONT};font-size:13px;line-height:1.62;color:#71717A;">
          Your address changes every time the secure tunnel restarts — a reboot, a crash, a power cut. When it does, the new link arrives here, so being away from home never means being locked out.
        </div>
      </td></tr>
    </table>
  </td></tr>
  <tr><td class="pad" style="padding:26px 32px 0 32px;">&nbsp;</td></tr>`,
    }),
  }
}
