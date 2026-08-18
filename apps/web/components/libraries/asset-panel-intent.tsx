"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

/**
 * Opening the asset panel *somewhere in particular*.
 *
 * Selecting a card opens the panel on Overview, which is right when the card was
 * all someone clicked. It is wrong when they clicked a running-transcript
 * indicator or picked Edit from the right-click menu: that is a request to land
 * on a specific section, and making them find it turns one click into three.
 *
 * So a caller may state where it wants to land. The intent is consumed once —
 * the panel reads it while mounting for that asset (and again when a new intent
 * arrives while the panel is already open) and then forgets it — because it
 * describes a navigation that happened, not a mode the panel is in.
 */

export type AssetPanelIntent = {
  assetId: string
  section?: "overview" | "edit" | "ai" | "move" | "share"
  /** Sub-tab within the AI section. */
  aiTab?: "transcript" | "title"
  /** Which transcript language to select once there. */
  language?: string
}

type ContextValue = {
  open: (intent: AssetPanelIntent) => void
  /** Reads and clears the intent, if it is for this asset. */
  consume: (assetId: string) => AssetPanelIntent | null
  /**
   * Bumps every time an intent is posted.
   * The panel watches this so a right-click action still works when the same
   * file is already selected (no remount → no useState initialiser).
   */
  generation: number
}

const AssetPanelIntentContext = createContext<ContextValue | null>(null)

export function AssetPanelIntentProvider({
  children,
  onOpen,
}: {
  children: ReactNode
  /** Selecting the asset is what actually opens the panel. */
  onOpen: (assetId: string) => void
}) {
  const pending = useRef<AssetPanelIntent | null>(null)
  const [generation, setGeneration] = useState(0)

  const open = useCallback(
    (intent: AssetPanelIntent) => {
      pending.current = intent
      setGeneration((g) => g + 1)
      onOpen(intent.assetId)
    },
    [onOpen],
  )

  const consume = useCallback((assetId: string) => {
    const intent = pending.current
    if (!intent || intent.assetId !== assetId) return null
    pending.current = null
    return intent
  }, [])

  const value = useMemo(() => ({ open, consume, generation }), [open, consume, generation])

  return (
    <AssetPanelIntentContext.Provider value={value}>{children}</AssetPanelIntentContext.Provider>
  )
}

/** Null outside a provider — cards render in places without a panel. */
export function useAssetPanelIntent(): ContextValue | null {
  return useContext(AssetPanelIntentContext)
}
