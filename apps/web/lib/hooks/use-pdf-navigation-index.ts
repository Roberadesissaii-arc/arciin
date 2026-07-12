"use client"

import { useEffect, useState } from "react"

import { fetchPdfNavigationIndex } from "@/lib/api/assets"
import type { PdfPageLabel } from "@arciin/shared"

export function usePdfNavigationIndex(assetId: string | undefined, enabled: boolean) {
  const [pageIndex, setPageIndex] = useState<PdfPageLabel[] | null>(null)
  const activeKey = enabled && assetId ? assetId : null

  useEffect(() => {
    if (!activeKey) return
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchPdfNavigationIndex(activeKey)
        if (!cancelled) setPageIndex(data.page_index)
      } catch {
        if (!cancelled) setPageIndex(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeKey])

  return activeKey ? pageIndex : null
}
