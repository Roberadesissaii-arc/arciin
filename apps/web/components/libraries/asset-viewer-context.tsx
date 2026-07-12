"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { AssetPreviewWorkspace } from "@/components/libraries/asset-preview-workspace"
import { filterViewableAssets } from "@/lib/utils/viewable-asset"
import type { AssetSummary } from "@/lib/types/models"

type ViewerLayout = "embedded" | "fullscreen"

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
  const [state, setState] = useState<{
    open: boolean
    index: number
    layout: ViewerLayout
    aiOpen: boolean
  }>({
    open: false,
    index: 0,
    layout: "embedded",
    aiOpen: false,
  })

  const openViewer = useCallback(
    (assetId: string) => {
      const index = viewableAssets.findIndex((a) => a.id === assetId)
      if (index < 0) return
      setState({
        open: true,
        index,
        layout: "embedded",
        aiOpen: false,
      })
    },
    [viewableAssets],
  )

  const closeViewer = useCallback(() => {
    setState((s) => ({ ...s, open: false }))
  }, [])

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= viewableAssets.length) return
      setState((s) => ({ ...s, open: true, index }))
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

  const workspace =
    state.open && viewableAssets.length > 0 ? (
      <AssetPreviewWorkspace
        key={`${state.layout}-${viewableAssets[state.index]?.id ?? state.index}`}
        assets={viewableAssets}
        index={state.index}
        embedded={state.layout === "embedded"}
        aiOpen={state.aiOpen}
        onAiOpenChange={(aiOpen) => setState((s) => ({ ...s, aiOpen }))}
        onClose={closeViewer}
        onExpand={() => setState((s) => ({ ...s, layout: "fullscreen" }))}
        onShrink={() => setState((s) => ({ ...s, layout: "embedded" }))}
        onNavigate={goTo}
      />
    ) : null

  return (
    <AssetViewerContext.Provider value={value}>
      {children}
      {workspace}
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
