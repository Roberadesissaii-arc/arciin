const PILL_COLORS: Record<string, string> = {
  OWNER: "#6366f1",
  ADMIN: "#2563eb",
  MEMBER: "#65a30d",
  VIEWER: "#64748b",
  ACTIVE: "#16a34a",
  DISABLED: "#dc2626",
  READY: "#16a34a",
  FAILED: "#dc2626",
  UPLOADING: "#d97706",
  PROCESSING: "#2563eb",
  DELETED: "#6b7280",
  QUEUED: "#d97706",
  COMPLETED: "#16a34a",
  VIDEO: "#6366f1",
  IMAGE: "#2563eb",
  AUDIO: "#db2777",
  DOCUMENT: "#ea580c",
  ARCHIVE: "#7c3aed",
  OTHER: "#64748b",
  true: "#16a34a",
  false: "#64748b",
}

export function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="font-mono text-xs text-zinc-400">null</span>
  }
  if (typeof value === "boolean") {
    const color = PILL_COLORS[String(value)] ?? "#64748b"
    return (
      <span
        className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
        style={{ backgroundColor: `${color}22`, color }}
      >
        {String(value)}
      </span>
    )
  }
  const str = String(value)
  const color = PILL_COLORS[str]
  if (color) {
    return (
      <span
        className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
        style={{ backgroundColor: `${color}22`, color }}
      >
        {str}
      </span>
    )
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    return (
      <span className="font-mono text-[11px] text-zinc-600">{new Date(str).toLocaleString()}</span>
    )
  }
  if (/^c[a-z0-9]{20,}$/.test(str)) {
    return <span className="font-mono text-[11px] text-zinc-600">{str.slice(0, 8)}…</span>
  }
  if (str.length > 48) {
    return (
      <span className="text-zinc-800" title={str}>
        {str.slice(0, 48)}…
      </span>
    )
  }
  return <span className="text-zinc-800">{str}</span>
}
