"use client"

import { useEffect, useState } from "react"

import { fetchPdfNavigationIndex } from "@/lib/api/assets"
import type { PdfPageLabel } from "@arciin/shared"

export function usePdfNavigationIndex(assetId: string | undefined, enabled: boolean) {
  const [pageIndex, setPageIndex] = useState<PdfPageLabel[] | null>(null)

  useEffect(() => {
    if (!enabled || !assetId) {
      setPageIndex(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchPdfNavigationIndex(assetId)
        if (!cancelled) setPageIndex(data.page_index)
      } catch {
        if (!cancelled) setPageIndex(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [assetId, enabled])

  return pageIndex
}
