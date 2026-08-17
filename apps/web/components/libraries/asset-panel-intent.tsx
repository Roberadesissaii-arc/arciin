"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"

/**
 * Opening the asset panel *somewhere in particular*.
 *
 * Selecting a card opens the panel on Overview, which is right when the card was
 * all someone clicked. It is wrong when they clicked a running-dub indicator:
 * that is a request to see that dub's progress, and making them find AI, then
 * Dubbing, then the right language turns one click into four.
 *
 * So a caller may state where it wants to land. The intent is consumed once —
 * the panel reads it while mounting for that asset and then forgets it — because
 * it describes a navigation that happened, not a mode the panel is in. Left
 * standing, it would drag the reader back to Dubbing every time they tried to
 * leave it.
 */

export type AssetPanelIntent = {
  assetId: string
  section?: "overview" | "edit" | "ai" | "move" | "share"
  /** Sub-tab within the AI section. */
  aiTab?: "transcript" | "dubbing" | "title"
  /** Which dub language to select once there. */
  language?: string
}

type ContextValue = {
  open: (intent: AssetPanelIntent) => void
  /** Reads and clears the intent, if it is for this asset. */
  consume: (assetId: string) => AssetPanelIntent | null
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
  // Only so consumers re-render when an intent is set; the value itself is read
  // from the ref, which is what makes "consume once" reliable under StrictMode's
  // double render.
  const [, setVersion] = useState(0)

  const open = useCallback(
    (intent: AssetPanelIntent) => {
      pending.current = intent
      setVersion((v) => v + 1)
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

  const value = useMemo(() => ({ open, consume }), [open, consume])

  return (
    <AssetPanelIntentContext.Provider value={value}>{children}</AssetPanelIntentContext.Provider>
  )
}

/** Null outside a provider — cards render in places without a panel. */
export function useAssetPanelIntent(): ContextValue | null {
  return useContext(AssetPanelIntentContext)
}
