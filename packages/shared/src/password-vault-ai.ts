/** Placeholder shown to AI providers — never the real secret. */
export const VAULT_AI_ENCRYPTED = "[VAULT_ENCRYPTED]"

export const PASSWORD_VAULT_AI_ACCESS_LEVELS = ["blocked", "count_only", "metadata"] as const
export type PasswordVaultAiAccessLevel = (typeof PASSWORD_VAULT_AI_ACCESS_LEVELS)[number]

/** Which non-password fields may appear in plaintext in AI context. Password is always VAULT_AI_ENCRYPTED. */
export type PasswordVaultAiShareSettings = {
  names: boolean
  usernames: boolean
  urls: boolean
  notes: boolean
}

export const DEFAULT_PASSWORD_VAULT_AI_SHARE: PasswordVaultAiShareSettings = {
  names: true,
  usernames: true,
  urls: true,
  notes: false,
}

export function parsePasswordVaultAiShare(raw: unknown): PasswordVaultAiShareSettings {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    names: s.names !== false,
    usernames: s.usernames !== false,
    urls: s.urls !== false,
    notes: s.notes === true,
  }
}

export type VaultEntryForAiRedaction = {
  name: string
  username?: string | null
  password?: string | null
  url?: string | null
  notes?: string | null
}

export function redactVaultField(
  value: string | null | undefined,
  allowed: boolean,
): string {
  if (!value?.trim()) return "—"
  return allowed ? value.trim() : VAULT_AI_ENCRYPTED
}

/** One line for AI context — password is never revealed. */
export function formatVaultEntryForAi(
  entry: VaultEntryForAiRedaction,
  share: PasswordVaultAiShareSettings,
): string {
  const name = share.names ? entry.name : VAULT_AI_ENCRYPTED
  const user = redactVaultField(entry.username, share.usernames)
  const pass = entry.password?.trim() ? VAULT_AI_ENCRYPTED : "—"
  const url = redactVaultField(entry.url, share.urls)
  const note =
    entry.notes?.trim() && share.notes
      ? entry.notes.trim().slice(0, 80)
      : entry.notes?.trim()
        ? VAULT_AI_ENCRYPTED
        : null

  const parts = [`- ${name}`, `username: ${user}`, `password: ${pass}`, `url: ${url}`]
  if (note) parts.push(`notes: ${note}`)
  return parts.join(" | ")
}

export function buildVaultAiContextBlock(input: {
  access: PasswordVaultAiAccessLevel
  entryCount: number
  entries: VaultEntryForAiRedaction[]
  share: PasswordVaultAiShareSettings
  queryHint?: string
  listAll?: boolean
}): string | null {
  const { access, entryCount, entries, share, queryHint, listAll } = input

  if (entryCount === 0 || access === "blocked") return null

  if (access === "count_only") {
    return `Password vault: ${entryCount} saved credential(s). Entry names and usernames are hidden from the assistant (count only). To let the assistant list names/usernames, set Settings → AI Security → Password vault to "Redacted metadata" and enable Names / Usernames share. Actual passwords stay ${VAULT_AI_ENCRYPTED}—never guess them. User can open [Passwords](/passwords) to view secrets.`
  }

  const limit = listAll ? 100 : 12
  const shown = entries.slice(0, limit)
  const truncated = entries.length > shown.length

  const sharedFields = [
    share.names ? "entry names" : null,
    share.usernames ? "usernames" : null,
    share.urls ? "login URLs/links" : null,
    share.notes ? "notes" : null,
  ].filter(Boolean)

  const header = [
    `Password vault (${entryCount} saved credential${entryCount === 1 ? "" : "s"}).`,
    sharedFields.length > 0
      ? `You may read and reply with these plaintext fields when present on a line: ${sharedFields.join(", ")}.`
      : `Only entry metadata you are allowed to see appears below.`,
    `Values shown as ${VAULT_AI_ENCRYPTED} are encrypted on the server—you must NOT invent or decode them.`,
    `When the user asks for a **password** value, name the matching entry and direct them to [Passwords](/passwords) to view or copy it.`,
    share.urls
      ? `When the user asks for a **URL** or **link** for an entry (including "send me the url"), quote the url field from the matching vault line—do not refuse or claim you cannot provide links.`
      : null,
  ]
    .filter(Boolean)
    .join(" ")

  const lines = shown.map((e) => formatVaultEntryForAi(e, share))
  const suffix = [
    truncated ? `(Showing ${shown.length} of ${entryCount} entries.)` : null,
    queryHint ? `(User question: ${queryHint.slice(0, 160)})` : null,
  ]
    .filter(Boolean)
    .join("\n")

  return [header, ...lines, suffix].filter(Boolean).join("\n")
}
