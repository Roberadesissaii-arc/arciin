// ── Column definition type ─────────────────────────────────────────────────────

export type ColumnDef = {
  id: string
  name: string
  type: string
  defaultValue: string
  nullable: boolean
  isPrimary: boolean
}

function colStorageKey(tableId: string) {
  return `arciin:db:cols:${tableId}`
}

export function loadColumns(tableId: string): ColumnDef[] {
  try {
    const raw = localStorage.getItem(colStorageKey(tableId))
    return raw ? (JSON.parse(raw) as ColumnDef[]) : []
  } catch { return [] }
}

export function saveColumns(tableId: string, cols: ColumnDef[]) {
  localStorage.setItem(colStorageKey(tableId), JSON.stringify(cols))
}

// ── Row form helpers ───────────────────────────────────────────────────────────

export function columnValueToTyped(col: ColumnDef, raw: string): unknown {
  if (raw === "" || raw === null) return col.nullable ? null : undefined
  switch (col.type) {
    case "int2": case "int4": case "int8": return parseInt(raw, 10)
    case "float4": case "float8": case "numeric": return parseFloat(raw)
    case "bool": return raw === "true" || raw === "1" || raw === "yes"
    case "json": case "jsonb":
      try { return JSON.parse(raw) } catch { return raw }
    default: return raw
  }
}

export function columnInputType(type: string): string {
  switch (type) {
    case "int2": case "int4": case "int8":
    case "float4": case "float8": case "numeric": return "number"
    case "bool": return "checkbox"
    case "date": return "date"
    case "time": case "timetz": return "time"
    case "timestamp": case "timestamptz": return "datetime-local"
    default: return "text"
  }
}

export function payloadFromRaw(text: string): Record<string, unknown> {
  const t = text.trim()
  if (!t) return {}
  try {
    const v = JSON.parse(t) as unknown
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  } catch { /* plain text */ }
  return { content: t }
}
