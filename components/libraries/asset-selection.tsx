"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import type { AssetSummary } from "@/lib/types/models"

export type AssetSelectionContextValue = {
  assets: AssetSummary[]
  selectedIds: Set<string>
  selectedAssets: AssetSummary[]
  isSelected: (id: string) => boolean
  toggle: (id: string, options?: { additive?: boolean; range?: boolean }) => void
  selectOnly: (id: string) => void
  setSelectedIds: (ids: Iterable<string>) => void
  clear: () => void
  selectAllVisible: () => void
  lastSelectedId: string | null
  setLastSelectedId: (id: string | null) => void
}

const AssetSelectionContext = createContext<AssetSelectionContextValue | null>(null)

export function AssetSelectionProvider({
  assets,
  children,
}: {
  assets: AssetSummary[]
  children: ReactNode
}) {
  const [selectedIds, setSelectedIdsState] = useState<Set<string>>(() => new Set())
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)

  const setSelectedIds = useCallback((ids: Iterable<string>) => {
    setSelectedIdsState(new Set(ids))
  }, [])

  const clear = useCallback(() => {
    setSelectedIdsState(new Set())
    setLastSelectedId(null)
  }, [])

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds])

  const selectOnly = useCallback((id: string) => {
    setSelectedIdsState(new Set([id]))
    setLastSelectedId(id)
  }, [])

  const toggle = useCallback(
    (id: string, options?: { additive?: boolean; range?: boolean }) => {
      const orderedIds = assets.map((a) => a.id)
      const index = orderedIds.indexOf(id)
      if (index < 0) return

      if (options?.range && lastSelectedId) {
        const anchor = orderedIds.indexOf(lastSelectedId)
        if (anchor >= 0) {
          const start = Math.min(anchor, index)
          const end = Math.max(anchor, index)
          const rangeIds = orderedIds.slice(start, end + 1)
          setSelectedIdsState((prev) => {
            const next = options.additive ? new Set(prev) : new Set<string>()
            for (const rid of rangeIds) next.add(rid)
            return next
          })
          setLastSelectedId(id)
          return
        }
      }

      setSelectedIdsState((prev) => {
        const next = options?.additive ? new Set(prev) : new Set<string>()
        if (next.has(id)) {
          if (options?.additive) next.delete(id)
          else next.add(id)
        } else {
          next.add(id)
        }
        return next
      })
      setLastSelectedId(id)
    },
    [assets, lastSelectedId],
  )

  const selectAllVisible = useCallback(() => {
    setSelectedIdsState(new Set(assets.map((a) => a.id)))
    if (assets[0]) setLastSelectedId(assets[0].id)
  }, [assets])

  useEffect(() => {
    const visible = new Set(assets.map((a) => a.id))
    setSelectedIdsState((prev) => {
      const next = new Set<string>()
      for (const id of prev) {
        if (visible.has(id)) next.add(id)
      }
      return next.size === prev.size ? prev : next
    })
  }, [assets])

  const selectedAssets = useMemo(
    () => assets.filter((a) => selectedIds.has(a.id)),
    [assets, selectedIds],
  )

  const value = useMemo<AssetSelectionContextValue>(
    () => ({
      assets,
      selectedIds,
      selectedAssets,
      isSelected,
      toggle,
      selectOnly,
      setSelectedIds,
      clear,
      selectAllVisible,
      lastSelectedId,
      setLastSelectedId,
    }),
    [
      assets,
      selectedIds,
      selectedAssets,
      isSelected,
      toggle,
      selectOnly,
      setSelectedIds,
      clear,
      selectAllVisible,
      lastSelectedId,
    ],
  )

  return <AssetSelectionContext.Provider value={value}>{children}</AssetSelectionContext.Provider>
}

export function useAssetSelection() {
  return useContext(AssetSelectionContext)
}

export function useAssetSelectionRequired() {
  const ctx = useContext(AssetSelectionContext)
  if (!ctx) {
    throw new Error("useAssetSelectionRequired must be used within AssetSelectionProvider")
  }
  return ctx
}
