"use client"

/**
 * Who owns the video edit drawer.
 *
 * The drawer is mounted once by the library browser and opened by whichever
 * card or row was clicked. Cards are rendered in a virtualised grid and rows in
 * a paged table; giving each one its own Sheet would mount dozens of them and
 * lose the open panel the moment its card scrolled out of view.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react"

import { VideoEditDrawer } from "@/components/libraries/video-edit-drawer"
import type { AssetSummary } from "@/lib/types/models"

type VideoEditContextValue = {
  /** Open the editor for this asset. */
  openEditor: (asset: AssetSummary) => void
  /** Whether this asset has an editor worth opening. */
  canEdit: (asset: AssetSummary) => boolean
}

const VideoEditContext = createContext<VideoEditContextValue | null>(null)

/** Video and music share the same transcript Assist workspace. */
export function assetHasVideoEditor(asset: AssetSummary): boolean {
  return asset.mediaType === "VIDEO" || asset.mediaType === "AUDIO"
}

export function VideoEditProvider({ children }: { children: React.ReactNode }) {
  const [asset, setAsset] = useState<AssetSummary | null>(null)
  const [open, setOpen] = useState(false)

  const openEditor = useCallback((next: AssetSummary) => {
    setAsset(next)
    setOpen(true)
  }, [])

  const value = useMemo<VideoEditContextValue>(
    () => ({ openEditor, canEdit: assetHasVideoEditor }),
    [openEditor],
  )

  return (
    <VideoEditContext.Provider value={value}>
      {children}
      {/*
        Kept mounted with the asset it last showed, so closing animates out
        rather than blanking. The transcript itself lives on the server, so
        nothing is lost either way.
      */}
      <VideoEditDrawer asset={asset} open={open} onOpenChange={setOpen} />
    </VideoEditContext.Provider>
  )
}

/** Null outside a library browser, so shared components stay usable elsewhere. */
export function useVideoEditor(): VideoEditContextValue | null {
  return useContext(VideoEditContext)
}
