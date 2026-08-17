"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { AssetBulkActionsBar } from "@/components/libraries/asset-bulk-actions-bar"
import { AssetSidePanel } from "@/components/libraries/asset-side-panel"
import { AssetViewerProvider } from "@/components/libraries/asset-viewer-context"
import { AssetSelectionProvider, useAssetSelectionRequired } from "@/components/libraries/asset-selection"
import { cn } from "@/lib/utils"
import type { AssetSummary } from "@/lib/types/models"

type Point = { x: number; y: number }

type MarqueeRect = { left: number; top: number; width: number; height: number }

function normalizeRect(start: Point, end: Point): MarqueeRect {
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  return { left, top, width, height }
}

function rectsIntersect(a: MarqueeRect, b: DOMRect, container: DOMRect): boolean {
  const aLeft = container.left + a.left
  const aTop = container.top + a.top
  const aRight = aLeft + a.width
  const aBottom = aTop + a.height
  return !(aRight < b.left || aLeft > b.right || aBottom < b.top || aTop > b.bottom)
}

function SelectableAssetsContainerInner({
  children,
  defaultLibraryId,
}: {
  children: ReactNode
  defaultLibraryId?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { selectedIds, setSelectedIds, clear } = useAssetSelectionRequired()
  const hasSelection = selectedIds.size > 0
  const [marquee, setMarquee] = useState<{
    start: Point
    current: Point
    additive: boolean
  } | null>(null)
  const draggingRef = useRef(false)

  const finishMarquee = useCallback(
    (start: Point, end: Point, additive: boolean) => {
      const container = containerRef.current
      if (!container) return

      const rect = normalizeRect(start, end)
      if (rect.width < 4 && rect.height < 4) return

      const containerRect = container.getBoundingClientRect()
      const hits: string[] = []
      const nodes = container.querySelectorAll<HTMLElement>("[data-asset-selectable]")
      nodes.forEach((node) => {
        const id = node.dataset.assetId
        if (!id) return
        if (rectsIntersect(rect, node.getBoundingClientRect(), containerRect)) {
          hits.push(id)
        }
      })

      if (hits.length === 0) return

      if (additive) {
        const next = new Set(selectedIds)
        for (const id of hits) next.add(id)
        setSelectedIds(next)
      } else {
        setSelectedIds(hits)
      }
    },
    [selectedIds, setSelectedIds],
  )

  useEffect(() => {
    if (!marquee) return

    const onMove = (event: MouseEvent) => {
      if (!containerRef.current) return
      const bounds = containerRef.current.getBoundingClientRect()
      setMarquee((prev) =>
        prev
          ? {
              ...prev,
              current: {
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
              },
            }
          : null,
      )
    }

    const onUp = (event: MouseEvent) => {
      if (!containerRef.current || !marquee) return
      const bounds = containerRef.current.getBoundingClientRect()
      const end = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      }
      finishMarquee(marquee.start, end, marquee.additive)
      setMarquee(null)
      draggingRef.current = false
      document.body.style.removeProperty("user-select")
    }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    return () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }, [marquee, finishMarquee])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clear()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [clear])

  const onMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest("button, a, input, textarea, [role='dialog'], [data-no-marquee]")) return

    const assetEl = target.closest<HTMLElement>("[data-asset-selectable]")
    const container = containerRef.current
    if (!container) return

    const bounds = container.getBoundingClientRect()
    const point = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    }

    const additive = event.metaKey || event.ctrlKey
    const range = event.shiftKey

    if (assetEl?.dataset.assetId) {
      if (range || additive) {
        return
      }
      // Selection toggles on card/row click — avoid mousedown select + click deselect.
    } else {
      if (!additive) clear()
    }

    draggingRef.current = true
    document.body.style.userSelect = "none"
    setMarquee({ start: point, current: point, additive })
  }

  const marqueeStyle =
    marquee && (Math.abs(marquee.current.x - marquee.start.x) > 2 || Math.abs(marquee.current.y - marquee.start.y) > 2)
      ? normalizeRect(marquee.start, marquee.current)
      : null

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "relative",
          marquee && "cursor-crosshair select-none",
          hasSelection ? "pb-24" : "pb-6",
        )}
        onMouseDown={onMouseDown}
      >
        {children}
        {marqueeStyle ? (
          <div
            className="pointer-events-none absolute z-20 rounded-sm border border-primary/70 bg-primary/10 ring-1 ring-primary/30"
            style={{
              left: marqueeStyle.left,
              top: marqueeStyle.top,
              width: marqueeStyle.width,
              height: marqueeStyle.height,
            }}
            aria-hidden
          />
        ) : null}
      </div>
      {/* One selected file gets a workspace; two or more get the bulk bar. The
          two are mutually exclusive by construction — see each component. */}
      <AssetSidePanel />
      <AssetBulkActionsBar defaultLibraryId={defaultLibraryId} />
    </>
  )
}

export function SelectableAssetsContainer({
  assets,
  children,
  defaultLibraryId,
}: {
  assets: AssetSummary[]
  children: ReactNode
  defaultLibraryId?: string
}) {
  return (
    <AssetSelectionProvider assets={assets}>
      <AssetViewerProvider assets={assets}>
        <SelectableAssetsContainerInner defaultLibraryId={defaultLibraryId}>
          {children}
        </SelectableAssetsContainerInner>
      </AssetViewerProvider>
    </AssetSelectionProvider>
  )
}
