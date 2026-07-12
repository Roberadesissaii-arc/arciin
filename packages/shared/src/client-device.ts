/** Friendly device label from a User-Agent string (browser + OS). */
export function parseClientDeviceLabel(userAgent: string | null | undefined): string | null {
  if (!userAgent?.trim()) return null

  const l = userAgent.toLowerCase()

  let browser = "Unknown"
  if (/edg\/|edghtml/.test(l)) browser = "Edge"
  else if (/opr\/|opera/.test(l)) browser = "Opera"
  else if (/firefox|fxios/.test(l)) browser = "Firefox"
  else if (/chrome|crios/.test(l)) browser = "Chrome"
  else if (/safari/.test(l)) browser = "Safari"

  let os = "Unknown"
  if (/iphone/.test(l)) os = "iOS"
  else if (/ipad/.test(l)) os = "iPadOS"
  else if (/android/.test(l)) os = "Android"
  else if (/mac os x|macos/.test(l)) os = "macOS"
  else if (/windows/.test(l)) os = "Windows"
  else if (/linux/.test(l)) os = "Linux"

  return `${browser} on ${os}`
}
