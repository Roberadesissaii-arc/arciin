/** Last N user turns concatenated — catches follow-ups like "send me the url" after a vault question. */
export function recentUserVaultContextText(
  messages: { role: string; content: string }[],
  maxUserMessages = 4,
): string {
  return messages
    .filter((m) => m.role === "user")
    .slice(-maxUserMessages)
    .map((m) => m.content)
    .join("\n")
}

/** Heuristic: user is asking about saved credentials / vault (not generic account-password help). */
export function isPasswordRelatedChatQuery(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false

  if (
    /\b(change|reset|update)\s+(?:my\s+)?(?:account\s+)?password\b/.test(t) &&
    !/\b(vault|saved|credential|docker|hub|bitwarden|login)\b/.test(t)
  ) {
    return false
  }

  const patterns = [
    /\bpassword\s+vault\b/,
    /\bsaved\s+(?:password|credential|login)s?\b/,
    /\bmy\s+(?:password|credential|login)s?\b/,
    /\bvault\s+(?:password|entry|entries)\b/,
    /\b(bitwarden|1password|lastpass)\b/,
    /\b(?:show|list|find|get|retrieve|copy|tell|give)\b.{0,50}\b(?:password|credential|login)s?\b/,
    /\b(?:password|credential|login)s?\b.{0,50}\b(?:for|to|on|in|from)\b/,
    /\bwhat(?:'s| is| are)\b.{0,40}\b(?:password|credential|username|name|entry|entries)\b/,
    /\bhow many\b.{0,30}\b(?:password|credential|login|entr)/,
    /\blogin\s+for\b/,
    /\bgo\s+to\s+my\s+password/,
    /\b(?:list|all)\b.{0,30}\b(?:username|usernames|names?)\b/,
    /\b(?:username|usernames)\b.{0,30}\b(?:list|all|vault|password|credential|saved)\b/,
    /\b(?:names?|entries)\b.{0,30}\b(?:password|vault|credential|saved)\b/,
    /\bi need the names\b/,
    /\bdocker\s*hub\b/,
    /\bpassword\s+page\b/,
    /\bsettings\s*→\s*password/,
    /\b(?:send|give|show|tell|what|need|get)\b.{0,35}\b(?:the\s+)?(?:url|link|login\s+link|website|uri)\b/,
    /\b(?:url|link|login\s+link)\b.{0,35}\b(?:for|to|of|from)\b/,
    /\b(?:url|link)\s+(?:for|of|to)\b/,
  ]

  return patterns.some((re) => re.test(t))
}

/** Password/vault topic in this turn or a recent user follow-up. */
export function isPasswordRelatedConversation(
  messages: { role: string; content: string }[],
): boolean {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? ""
  if (isPasswordRelatedChatQuery(last)) return true
  const recent = recentUserVaultContextText(messages)
  return recent !== last && isPasswordRelatedChatQuery(recent)
}

/** User wants a full list of vault entry names / usernames (not a single lookup). */
export function isVaultListingQuery(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false

  if (/\bhow many\b.{0,25}\b(?:password|credential|entr)/.test(t)) return false

  return (
    /\b(?:list|show|tell|give|enumerate|display)\b.{0,40}\b(?:all\s+)?(?:username|usernames|names?|entries|credentials?)\b/.test(
      t,
    ) ||
    /\b(?:username|usernames|names?|entries)\b.{0,40}\b(?:list|all|vault|password|saved)\b/.test(t) ||
    /\bwhat are the names\b/.test(t) ||
    /\bi need the names\b/.test(t) ||
    /\blist all\b/.test(t)
  )
}
