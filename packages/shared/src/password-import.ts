export type PasswordImportEntry = {
  name: string
  url?: string
  username?: string
  password?: string
  notes?: string
  category?: string
}

const HEADER_ALIASES: Record<string, keyof PasswordImportEntry | "username2" | "otp"> = {
  name: "name",
  title: "name",
  site: "name",
  /** Chrome / Edge / Firefox export headers */
  website: "url",
  url: "url",
  uri: "url",
  loginurl: "url",
  origin: "url",
  hostname: "url",
  login: "username",
  user: "username",
  username: "username",
  username2: "username2",
  username3: "username2",
  email: "username",
  password: "password",
  pass: "password",
  pwd: "password",
  note: "notes",
  notes: "notes",
  category: "category",
  folder: "category",
  otpsecret: "otp",
  otp: "otp",
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "")
}

function asString(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v.trim()
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return ""
}

function mapHeaderRecord(record: Record<string, string>): PasswordImportEntry | null {
  const out: Partial<PasswordImportEntry> & { username2?: string } = {}
  let otp: string | undefined

  for (const [key, value] of Object.entries(record)) {
    const v = value.trim()
    if (!v) continue
    const mapped = HEADER_ALIASES[normalizeHeader(key)]
    if (!mapped) continue
    if (mapped === "otp") {
      otp = v
      continue
    }
    if (mapped === "username2") {
      if (!out.username) out.username = v
      else out.username2 = v
      continue
    }
    if (mapped === "name" && !out.name) out.name = v
    else if (mapped === "name" && out.name) out.url = out.url ?? v
    else if (mapped === "url" && !out.url) out.url = v.startsWith("http") ? v : `https://${v}`
    else if (mapped === "username" && !out.username) out.username = v
    else if (mapped === "password" && !out.password) out.password = v
    else if (mapped === "notes" && !out.notes) out.notes = v
    else if (mapped === "category" && !out.category) out.category = v
  }

  if (!out.name) {
    out.name = out.url ?? out.username ?? "Imported entry"
  }

  if (otp) {
    out.notes = out.notes ? `${out.notes} (OTP configured)` : "OTP configured"
  }

  if (!out.name.trim()) return null
  return {
    name: out.name.trim(),
    url: out.url?.trim() || undefined,
    username: out.username?.trim() || undefined,
    password: out.password?.trim() || undefined,
    notes: out.notes?.trim() || undefined,
    category: out.category?.trim() || undefined,
  }
}

function extractLoginUri(login: Record<string, unknown>): string | undefined {
  const direct = asString(login.uri)
  if (direct) return direct.startsWith("http") ? direct : `https://${direct}`

  const uris = login.uris
  if (!Array.isArray(uris) || uris.length === 0) return undefined

  for (const item of uris) {
    if (typeof item === "string" && item.trim()) {
      const u = item.trim()
      return u.startsWith("http") ? u : `https://${u}`
    }
    if (item && typeof item === "object") {
      const uri = asString((item as Record<string, unknown>).uri)
      if (uri) return uri.startsWith("http") ? uri : `https://${uri}`
    }
  }
  return undefined
}

/** Bitwarden / nested login JSON and common manager export shapes. */
export function parsePasswordJsonRow(row: unknown): PasswordImportEntry | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null
  const o = row as Record<string, unknown>

  if (o.login && typeof o.login === "object" && !Array.isArray(o.login)) {
    const login = o.login as Record<string, unknown>
    return mapHeaderRecord({
      title: asString(o.name) || asString(o.title),
      username: asString(login.username) || asString(login.email),
      password: asString(login.password),
      url: extractLoginUri(login) ?? "",
      notes: asString(o.notes) || asString(o.note),
      category: asString(o.folder) || asString(o.collection) || asString(o.category),
    })
  }

  if (Array.isArray(o.fields)) {
    const flat: Record<string, string> = { title: asString(o.name) || asString(o.title) }
    for (const field of o.fields) {
      if (!field || typeof field !== "object") continue
      const f = field as Record<string, unknown>
      const type = asString(f.type).toLowerCase()
      const value = asString(f.value)
      if (!value) continue
      if (type === "username" || type === "email") flat.username = value
      else if (type === "password") flat.password = value
      else if (type === "url" || type === "uri") flat.url = value
      else if (type === "notes") flat.notes = value
    }
    return mapHeaderRecord(flat)
  }

  const flat: Record<string, string> = {}
  for (const [key, value] of Object.entries(o)) {
    if (value == null || typeof value === "object") continue
    flat[key] = asString(value)
  }

  if (asString(o.usernameValue)) flat.username = asString(o.usernameValue)
  if (asString(o.passwordValue)) flat.password = asString(o.passwordValue)
  if (asString(o.origin)) flat.url = asString(o.origin)
  if (asString(o.hostname) && !flat.url) flat.url = asString(o.hostname)

  return mapHeaderRecord(flat)
}

function collectJsonRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>
    for (const key of ["items", "passwords", "entries", "logins", "accounts", "data", "vault"]) {
      const arr = o[key]
      if (Array.isArray(arr)) return arr
    }
    return [data]
  }
  return []
}

function parseJsonText(text: string): PasswordImportEntry[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const tryParse = (source: string): unknown => JSON.parse(source)

  let data: unknown
  try {
    data = tryParse(trimmed)
  } catch {
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    if (lines.length > 1 && lines.every((l) => l.startsWith("{"))) {
      const rows: PasswordImportEntry[] = []
      for (const line of lines) {
        try {
          const row = tryParse(line)
          const entry = parsePasswordJsonRow(row)
          if (entry) rows.push(entry)
        } catch {
          /* skip bad line */
        }
      }
      if (rows.length > 0) return rows
    }

    if (!trimmed.endsWith("]") && trimmed.startsWith("[")) {
      try {
        data = tryParse(`${trimmed}]`)
      } catch {
        try {
          data = tryParse(`[${trimmed}]`)
        } catch {
          return []
        }
      }
    } else if (!trimmed.startsWith("[") && trimmed.startsWith("{")) {
      try {
        data = tryParse(`[${trimmed}]`)
      } catch {
        return []
      }
    } else {
      return []
    }
  }

  return collectJsonRows(data)
    .map((row) => parsePasswordJsonRow(row))
    .filter((e): e is PasswordImportEntry => e !== null)
}

function splitDelimitedLine(line: string): string[] {
  const trimmed = line.trim()
  if (!trimmed) return []

  if (trimmed.includes("|")) {
    return trimmed
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0)
  }
  if (trimmed.includes("\t")) {
    return trimmed.split("\t").map((c) => c.trim())
  }

  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (ch === "," && !inQuotes) {
      out.push(cur.trim())
      cur = ""
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out.filter((c) => c.length > 0)
}

function looksLikeHeader(cells: string[]): boolean {
  const joined = cells.join(" ").toLowerCase()
  return (
    joined.includes("password") ||
    joined.includes("username") ||
    joined.includes("title") ||
    joined.includes("url") ||
    joined.includes("note")
  )
}

/** title,username,password,url row without a header line. */
function parseTitleUsernamePasswordUrlRow(cells: string[]): PasswordImportEntry | null {
  if (cells.length < 4) return null
  const [title, username, password, url] = cells
  return mapHeaderRecord({
    title: title ?? "",
    username: username ?? "",
    password: password ?? "",
    url: url ?? "",
  })
}

function inferRowFromCells(cells: string[]): PasswordImportEntry | null {
  const cleaned = cells.map((c) => c.trim()).filter((c) => c.length > 0)
  if (cleaned.length === 0) return null

  if (cleaned.length >= 4) {
    const fourCol = parseTitleUsernamePasswordUrlRow(cleaned)
    if (fourCol?.password || fourCol?.username) return fourCol
  }

  const emailIdx = cleaned.findIndex((c) => c.includes("@") && !c.startsWith("http"))
  const urlIdx = cleaned.findIndex(
    (c) => /^https?:\/\//i.test(c) || /\.(com|org|net|io|app|dev|co)\b/i.test(c),
  )

  let passwordIdx = -1
  for (let i = cleaned.length - 1; i >= 0; i--) {
    if (i === emailIdx || i === urlIdx) continue
    const c = cleaned[i]!
    if (c.length >= 4 && /[A-Za-z]/.test(c) && /[0-9@#$_!-]/.test(c)) {
      passwordIdx = i
      break
    }
  }
  if (passwordIdx < 0 && cleaned.length >= 2) {
    passwordIdx = cleaned.length - 1
  }

  const name = cleaned[0] ?? "Imported entry"
  const username =
    emailIdx >= 0
      ? cleaned[emailIdx]
      : cleaned.length > 2 && passwordIdx > 1
        ? cleaned[1]
        : undefined
  const password = passwordIdx >= 0 ? cleaned[passwordIdx] : undefined
  let url: string | undefined
  if (urlIdx >= 0) {
    url = cleaned[urlIdx]!
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  }

  return mapHeaderRecord({
    title: name,
    username: username ?? "",
    password: password ?? "",
    url: url ?? "",
  })
}

function parseDelimitedText(text: string): PasswordImportEntry[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length === 0) return []

  const firstCells = splitDelimitedLine(lines[0]!)
  const hasHeader = looksLikeHeader(firstCells)
  const dataLines = hasHeader ? lines.slice(1) : lines

  if (hasHeader) {
    return dataLines
      .map((line) => {
        const cols = splitDelimitedLine(line)
        const record: Record<string, string> = {}
        firstCells.forEach((header, i) => {
          if (cols[i] !== undefined) record[header] = cols[i]!
        })
        return mapHeaderRecord(record)
      })
      .filter((e): e is PasswordImportEntry => e !== null)
  }

  return dataLines
    .map((line) => inferRowFromCells(splitDelimitedLine(line)))
    .filter((e): e is PasswordImportEntry => e !== null)
}

/** Parse CSV, pipe-separated, TSV, plain-text rows, or JSON password exports. */
export function parsePasswordImportFile(text: string, fileName?: string): PasswordImportEntry[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const lower = (fileName ?? "").toLowerCase()
  const looksJson =
    lower.endsWith(".json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    (trimmed.includes('"login"') && trimmed.includes("{"))

  if (looksJson) {
    const jsonRows = parseJsonText(trimmed)
    if (jsonRows.length > 0) return jsonRows
  }

  const delimited = parseDelimitedText(trimmed)
  if (delimited.length > 0) return delimited

  if (!looksJson) {
    const jsonRows = parseJsonText(trimmed)
    if (jsonRows.length > 0) return jsonRows
  }

  return []
}

/** True when an entry has enough data to store in the vault. */
export function isVaultImportEntry(entry: PasswordImportEntry): boolean {
  return Boolean(entry.password || entry.username || entry.url)
}
