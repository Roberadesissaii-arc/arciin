import type { AppDatabaseSummary } from "@/lib/types/models"

const ADJ = ["bright", "swift", "calm", "deep", "fresh", "golden", "bold", "clean", "smart", "warm", "sharp", "quiet"]
const NOUN = ["store", "hub", "base", "vault", "pool", "node", "core", "shelf", "stack", "deck", "log", "cache"]

export function generateDatabaseName() {
  return `${ADJ[Math.floor(Math.random() * ADJ.length)]}-${NOUN[Math.floor(Math.random() * NOUN.length)]}`
}

export function filterDatabases(list: AppDatabaseSummary[], q: string): AppDatabaseSummary[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return list
  return list.filter((db) => {
    const hay = `${db.name} ${db.slug} ${db.description ?? ""}`.toLowerCase()
    return hay.includes(needle)
  })
}
