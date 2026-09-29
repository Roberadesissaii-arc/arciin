"use client"

import type { AssetPage } from "@/lib/api/assets"

const HINTS: Partial<Record<NonNullable<AssetPage["semantic"]>, string>> = {
  unavailable: "Semantic search unavailable — showing name matches.",
  not_indexed: "Semantic index still building — showing name matches.",
}

/**
 * One quiet line under the search box when a search could not include
 * matches by meaning (Ollama stopped, model missing, nothing indexed yet).
 * Name matches are shown as always; nothing blocks.
 */
export function SemanticSearchHint({ search, semantic }: { search: string; semantic: AssetPage["semantic"] }) {
  const hint = semantic ? HINTS[semantic] : undefined
  if (!search.trim() || !hint) return null
  return (
    <p className="text-[11px] text-zinc-400" role="status" data-testid={`semantic-${semantic?.replace("_", "-")}`}>
      {hint}
    </p>
  )
}
