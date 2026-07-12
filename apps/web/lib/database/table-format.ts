import type { AppDatabaseFolderSummary, AppDatabaseRecordSummary, AppDatabaseSummary } from "@/lib/types/models"

export const typeBadgeClass =
  "border-0 bg-primary text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90"

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function approxTableSizeBytes(f: AppDatabaseFolderSummary): number {
  return utf8ByteLength(JSON.stringify({ path: f.pathCache, name: f.name })) + f.recordCount * 96
}

export function approxDatabaseIndexBytes(db: AppDatabaseSummary): number {
  const meta = JSON.stringify({
    name: db.name,
    slug: db.slug,
    description: db.description ?? "",
  })
  return utf8ByteLength(meta) + Math.max(0, db.folderCount) * 400
}

export function recordPayloadBytes(r: AppDatabaseRecordSummary): number {
  try { return utf8ByteLength(JSON.stringify(r.payload)) } catch { return 0 }
}

export function recordRowKind(r: AppDatabaseRecordSummary): "JSON" | "TEXT" {
  if (r.mimeType?.startsWith("text/")) return "TEXT"
  const p = r.payload
  const keys = Object.keys(p)
  if (keys.length === 1 && keys[0] === "content" && typeof p.content === "string") return "TEXT"
  return "JSON"
}
