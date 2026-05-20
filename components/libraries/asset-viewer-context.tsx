"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { AssetViewerOverlay } from "@/components/libraries/asset-viewer-overlay"
import { filterViewableAssets } from "@/lib/utils/viewable-asset"
import type { AssetSummary } from "@/lib/types/models"

type AssetViewerContextValue = {
  openViewer: (assetId: string) => void
  canOpen: (asset: AssetSummary) => boolean
}

const AssetViewerContext = createContext<AssetViewerContextValue | null>(null)

export function AssetViewerProvider({
  assets,
  children,
}: {
  assets: AssetSummary[]
  children: ReactNode
}) {
  const viewableAssets = useMemo(() => filterViewableAssets(assets), [assets])
  const [state, setState] = useState<{ open: boolean; index: number }>({
    open: false,
    index: 0,
  })

  const openViewer = useCallback(
    (assetId: string) => {
      const index = viewableAssets.findIndex((a) => a.id === assetId)
      if (index < 0) return
      setState({ open: true, index })
    },
    [viewableAssets],
  )

  const closeViewer = useCallback(() => {
    setState((s) => ({ ...s, open: false }))
  }, [])

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= viewableAssets.length) return
      setState({ open: true, index })
    },
    [viewableAssets.length],
  )

  const value = useMemo<AssetViewerContextValue>(
    () => ({
      openViewer,
      canOpen: (asset) => viewableAssets.some((a) => a.id === asset.id),
    }),
    [openViewer, viewableAssets],
  )

  return (
    <AssetViewerContext.Provider value={value}>
      {children}
      {state.open && viewableAssets.length > 0 ? (
        <AssetViewerOverlay
          key={viewableAssets[state.index]?.id ?? state.index}
          assets={viewableAssets}
          initialIndex={state.index}
          onClose={closeViewer}
          onNavigate={goTo}
        />
      ) : null}
    </AssetViewerContext.Provider>
  )
}

export function useAssetViewer() {
  const ctx = useContext(AssetViewerContext)
  if (!ctx) {
    throw new Error("useAssetViewer must be used within AssetViewerProvider")
  }
  return ctx
}

export function useAssetViewerOptional() {
  return useContext(AssetViewerContext)
}
