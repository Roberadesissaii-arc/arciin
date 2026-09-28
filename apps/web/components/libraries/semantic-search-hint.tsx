"use client"

import type { AssetPage } from "@/lib/api/assets"

/**
 * One quiet line under the search box when a search could not include
 * matches by meaning (Ollama stopped, model missing). Name matches are shown
 * as always; nothing blocks.
 */
export function SemanticSearchHint({ search, semantic }: { search: string; semantic: AssetPage["semantic"] }) {
  if (!search.trim() || semantic !== "unavailable") return null
  return (
    <p className="text-[11px] text-zinc-400" role="status" data-testid="semantic-unavailable">
      Semantic search unavailable — showing name matches.
    </p>
  )
}
