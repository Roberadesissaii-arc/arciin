"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { PDFDocumentProxy } from "pdfjs-dist"

import { PdfPreviewLoading } from "@/components/libraries/pdf-preview-loading"
import {
  fetchPdfDocument,
  getCachedPdfDocument,
  hasPdfDocumentCache,
  releasePdfDocument,
} from "@/lib/files/fetch-pdf-document"
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value"
import { findHighlightRectsOnPage } from "@/lib/files/pdf-page-text-search"
import type { PdfHighlightRect, PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"
import { cn } from "@/lib/utils"

const PAGE_PAD = 12
const WINDOW_BEFORE = 2
const WINDOW_AFTER = 5
const RENDER_WIDTH_EPS = 0.12
const EMPTY_PAGE_HIGHLIGHTS = new Map<number, PdfHighlightRect[]>()

function defaultPageHeight(layoutWidth: number) {
  return Math.round(layoutWidth * 1.294) + PAGE_PAD
}

function PdfPageCanvas({
  pdf,
  pageNumber,
  layoutWidth,
  renderWidth,
  numPages,
  onHeight,
  highlightRects,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  layoutWidth: number
  renderWidth: number
  numPages: number
  onHeight: (page: number, height: number) => void
  highlightRects?: PdfHighlightRect[]
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastRenderWidthRef = useRef(0)
  const displayHeightRef = useRef(0)
  const [ready, setReady] = useState(false)
  const [cssHeight, setCssHeight] = useState(() => defaultPageHeight(layoutWidth))
  const renderGenRef = useRef(0)

  const dprCap = numPages > 120 ? 1.25 : numPages > 60 ? 1.5 : 2

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !ready || lastRenderWidthRef.current < 1 || displayHeightRef.current < 1) return
    const displayH =
      layoutWidth > 0 && lastRenderWidthRef.current > 0
        ? Math.floor((displayHeightRef.current * layoutWidth) / lastRenderWidthRef.current)
        : displayHeightRef.current
    canvas.style.width = `${layoutWidth}px`
    canvas.style.height = `${displayH}px`
    setCssHeight(displayH + PAGE_PAD)
  }, [layoutWidth, ready])

  useEffect(() => {
    const host = hostRef.current
    if (!host || renderWidth < 1) return

    const prevRender = lastRenderWidthRef.current
    const widthDelta =
      prevRender > 0 ? Math.abs(renderWidth - prevRender) / prevRender : 1
    if (ready && widthDelta < RENDER_WIDTH_EPS) return

    const gen = ++renderGenRef.current
    let cancelled = false

    const renderPage = () => {
      void (async () => {
        try {
          const page = await pdf.getPage(pageNumber)
          const base = page.getViewport({ scale: 1 })
          const fitScale = renderWidth / base.width
          const height = Math.floor(base.height * fitScale)
          const dpr =
            typeof window !== "undefined"
              ? Math.min(Math.max(window.devicePixelRatio || 1, 1), dprCap)
              : 1.5
          const renderViewport = page.getViewport({ scale: fitScale * dpr })
          const canvas = document.createElement("canvas")
          canvas.width = Math.floor(renderViewport.width)
          canvas.height = Math.floor(renderViewport.height)
          const ctx = canvas.getContext("2d", { alpha: false })
          if (!ctx || cancelled || gen !== renderGenRef.current) {
            page.cleanup()
            return
          }
          await page.render({ canvasContext: ctx, viewport: renderViewport, canvas }).promise
          page.cleanup()
          if (cancelled || gen !== renderGenRef.current) return

          const displayH =
            layoutWidth > 0 && renderWidth > 0
              ? Math.floor((height * layoutWidth) / renderWidth)
              : height

          lastRenderWidthRef.current = renderWidth
          displayHeightRef.current = displayH
          setCssHeight(displayH + PAGE_PAD)
          onHeight(pageNumber, displayH + PAGE_PAD)

          const prev = canvasRef.current
          if (prev?.parentElement === host) prev.remove()
          canvas.style.width = `${layoutWidth}px`
          canvas.style.height = `${displayH}px`
          canvas.className = "block rounded-sm bg-white shadow-[0_4px_24px_rgba(0,0,0,0.35)]"
          canvas.setAttribute("draggable", "false")
          host.appendChild(canvas)
          canvasRef.current = canvas
          setReady(true)
        } catch (err) {
          // Swallowing this silently once hid a total render failure: every page
          // stayed on the grey placeholder with nothing in the console.
          console.error(`[pdf] page ${pageNumber} render failed`, err)
        }
      })()
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) renderPage()
      },
      { rootMargin: "160px 0px", threshold: 0.01 },
    )

    observer.observe(host)
    renderPage()

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [dprCap, layoutWidth, onHeight, pageNumber, pdf, ready, renderWidth])

  useEffect(() => {
    const host = hostRef.current
    return () => {
      const c = canvasRef.current
      if (host && c?.parentElement === host) c.remove()
      canvasRef.current = null
      setReady(false)
      lastRenderWidthRef.current = 0
    }
  }, [pageNumber])

  return (
    <div
      ref={hostRef}
      className="relative flex shrink-0 justify-center py-1.5"
      data-pdf-page={pageNumber}
      style={{ minHeight: cssHeight }}
    >
      {!ready ? (
        <div
          className="rounded-sm bg-zinc-800/80"
          style={{ width: layoutWidth, height: Math.max(120, cssHeight - PAGE_PAD) }}
          aria-hidden
        />
      ) : null}
      {ready && highlightRects && highlightRects.length > 0 ? (
        <div className="pointer-events-none absolute inset-0 flex justify-center py-1.5" aria-hidden>
          <div className="relative" style={{ width: layoutWidth, height: cssHeight - PAGE_PAD }}>
            {highlightRects.map((rect, i) => (
              <div
                key={i}
                className="absolute rounded-sm border border-[#ff4f12]/70 bg-[#ff4f12]/30 shadow-[0_0_0_1px_rgba(255,79,18,0.15)] animate-in fade-in duration-300"
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function DesktopPdfViewer({
  fileUrl,
  zoom = 1,
  scrollToPage,
  scrollToPageAt,
  highlightTargets,
  highlightAt,
  onPageChange,
}: {
  fileUrl: string
  zoom?: number
  scrollToPage?: number
  scrollToPageAt?: number
  highlightTargets?: PdfHighlightTarget[]
  highlightAt?: number
  onPageChange?: (page: number, total: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const onPageChangeRef = useRef(onPageChange)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevLayoutWidthRef = useRef(0)
  const scrollRestoreRef = useRef(false)
  const pendingScrollRatioRef = useRef<number | null>(null)
  /** Dedupe scroll runs per target + measured height (re-scroll when page height is measured). */
  const lastScrollKeyRef = useRef("")
  const anchorPageRef = useRef(1)
  const programmaticScrollUntilRef = useRef(0)
  const updateWindowFromScrollRef = useRef<() => void>(() => {})
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(() => getCachedPdfDocument(fileUrl))
  const [numPages, setNumPages] = useState(() => getCachedPdfDocument(fileUrl)?.numPages ?? 0)
  const [loading, setLoading] = useState(() => !hasPdfDocumentCache(fileUrl))
  const [error, setError] = useState<string | null>(null)
  const [viewWidth, setViewWidth] = useState(640)
  const [pageWindow, setPageWindow] = useState({ start: 1, end: 8 })
  const [pageHeights, setPageHeights] = useState<Map<number, number>>(() => new Map())
  const [pageHighlights, setPageHighlights] = useState<Map<number, PdfHighlightRect[]>>(
    () => new Map(),
  )

  useEffect(() => {
    onPageChangeRef.current = onPageChange
  }, [onPageChange])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const applyWidth = (w: number) => {
      if (w > 0) setViewWidth(Math.floor(w))
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (!w || w <= 0) return
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => applyWidth(w), 180)
    })
    ro.observe(el)
    applyWidth(el.clientWidth || 640)
    return () => {
      ro.disconnect()
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    /**
     * Only the side that actually took a reference may give one back. Cleanup
     * used to release unconditionally, so when it ran before the fetch resolved
     * the async branch released a second time — refs hit 0, the document was
     * destroyed mid-render, and every page died on `sendWithPromise of null`
     * leaving a blank viewer. It raced on load time, so short PDFs lost almost
     * every time and large ones only sometimes.
     */
    let acquired = false

    void (async () => {
      if (!hasPdfDocumentCache(fileUrl)) {
        setLoading(true)
        setError(null)
        setNumPages(0)
        setPdfDoc(null)
      }

      try {
        const pdf = await fetchPdfDocument(fileUrl)
        acquired = true
        if (cancelled) {
          acquired = false
          releasePdfDocument(fileUrl)
          return
        }
        setPdfDoc(pdf)
        setNumPages(pdf.numPages)
        setLoading(false)
        requestAnimationFrame(() => {
          updateWindowFromScrollRef.current()
        })
      } catch {
        if (!cancelled) {
          setError("Could not open this PDF.")
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      if (acquired) {
        acquired = false
        releasePdfDocument(fileUrl)
      }
    }
  }, [fileUrl])

  const layoutWidth = Math.max(200, Math.floor((viewWidth - 32) * zoom))
  const renderWidth = useDebouncedValue(layoutWidth, 600)

  useEffect(() => {
    if (!highlightTargets?.length) return
    const pdf = pdfDoc
    const width = Math.max(layoutWidth, renderWidth)
    if (!pdf || width < 1) return

    let cancelled = false
    void (async () => {
      const next = new Map<number, PdfHighlightRect[]>()
      for (const target of highlightTargets) {
        const rects = await findHighlightRectsOnPage(
          pdf,
          target.page,
          target.quote,
          width,
          target.kind === "heading" ? "heading" : "default",
        )
        if (cancelled) return
        if (rects.length > 0) {
          const prev = next.get(target.page) ?? []
          next.set(target.page, [...prev, ...rects])
        }
      }
      if (!cancelled) setPageHighlights(next)
    })()

    return () => {
      cancelled = true
    }
  }, [highlightAt, highlightTargets, layoutWidth, pdfDoc, renderWidth])

  useEffect(() => {
    const root = scrollRef.current
    if (!root || loading || numPages < 1) return

    const prev = prevLayoutWidthRef.current
    if (prev <= 0) {
      prevLayoutWidthRef.current = layoutWidth
      return
    }
    if (prev === layoutWidth) return

    const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight)
    const scrollRatio = maxScroll > 0 ? root.scrollTop / maxScroll : 0
    const scale = layoutWidth / prev

    if (pageHeights.size > 0 && Math.abs(scale - 1) > 0.01) {
      setPageHeights((prev) => {
        const next = new Map(prev)
        for (const [page, h] of prev.entries()) {
          next.set(page, Math.round(h * scale))
        }
        return next
      })
    }

    prevLayoutWidthRef.current = layoutWidth
    pendingScrollRatioRef.current = scrollRatio
    scrollRestoreRef.current = true
  }, [layoutWidth, loading, numPages, pageHeights])

  useLayoutEffect(() => {
    const ratio = pendingScrollRatioRef.current
    if (ratio === null) return
    const root = scrollRef.current
    if (!root) return
    const max = Math.max(0, root.scrollHeight - root.clientHeight)
    root.scrollTop = ratio * max
    pendingScrollRatioRef.current = null
    scrollRestoreRef.current = false
  }, [layoutWidth, pageHeights])

  const getPageHeight = useCallback(
    (page: number) => pageHeights.get(page) ?? defaultPageHeight(layoutWidth),
    [layoutWidth, pageHeights],
  )

  const offsetBefore = useCallback(
    (page: number) => {
      let sum = 0
      for (let p = 1; p < page; p++) sum += getPageHeight(p)
      return sum
    },
    [getPageHeight],
  )

  const totalScrollHeight = useMemo(() => {
    if (numPages < 1) return 0
    let sum = 0
    for (let p = 1; p <= numPages; p++) sum += getPageHeight(p)
    return sum
  }, [getPageHeight, numPages])

  const onHeight = useCallback((page: number, height: number) => {
    setPageHeights((prev) => {
      if (prev.get(page) === height) return prev
      const next = new Map(prev)
      next.set(page, height)
      return next
    })
  }, [])

  const updateWindowFromScroll = useCallback(() => {
    const root = scrollRef.current
    if (!root || numPages < 1) return
    if (Date.now() < programmaticScrollUntilRef.current) return

    const scrollTop = root.scrollTop
    let acc = 0
    let current = 1
    for (let p = 1; p <= numPages; p++) {
      const h = getPageHeight(p)
      if (acc + h > scrollTop + root.clientHeight * 0.2) {
        current = p
        break
      }
      acc += h
      current = p
    }

    const start = Math.max(1, current - WINDOW_BEFORE)
    const end = Math.min(numPages, current + WINDOW_AFTER)
    setPageWindow((prev) =>
      prev.start === start && prev.end === end ? prev : { start, end },
    )

    const mid = scrollTop + root.clientHeight * 0.35
    let best = 1
    let bestDist = Number.POSITIVE_INFINITY
    for (let p = start; p <= end; p++) {
      const top = offsetBefore(p)
      const dist = Math.abs(top - mid)
      if (dist < bestDist) {
        bestDist = dist
        best = p
      }
    }

    // Incomplete height estimates can briefly report page 1 while scrolled deep in the doc.
    if (best === 1 && scrollTop > 400 && numPages > 1) return

    anchorPageRef.current = best
    onPageChangeRef.current?.(best, numPages)
  }, [getPageHeight, numPages, offsetBefore])

  useEffect(() => {
    updateWindowFromScrollRef.current = updateWindowFromScroll
  }, [updateWindowFromScroll])

  useEffect(() => {
    const root = scrollRef.current
    if (!root || loading || numPages < 1) return
    const onScroll = () => {
      if (scrollRestoreRef.current) return
      updateWindowFromScrollRef.current()
    }
    root.addEventListener("scroll", onScroll, { passive: true })
    updateWindowFromScrollRef.current()
    return () => root.removeEventListener("scroll", onScroll)
  }, [loading, numPages])

  const prevScrollHeightRef = useRef(0)
  useLayoutEffect(() => {
    if (pendingScrollRatioRef.current !== null || scrollRestoreRef.current) return
    if (Date.now() < programmaticScrollUntilRef.current) return
    const root = scrollRef.current
    if (!root) return

    const prevH = prevScrollHeightRef.current
    const newH = root.scrollHeight
    const maxPrev = Math.max(0, prevH - root.clientHeight)
    const maxNew = Math.max(0, newH - root.clientHeight)
    if (prevH > 0 && newH > 0 && maxPrev > 0 && maxNew > 0 && prevH !== newH) {
      const ratio = root.scrollTop / maxPrev
      root.scrollTop = ratio * maxNew
    }
    prevScrollHeightRef.current = newH
  }, [pageHeights])

  useEffect(() => {
    if (!scrollToPage || scrollToPage < 1 || numPages < 1 || scrollToPageAt == null) return

    const page = Math.min(scrollToPage, numPages)
    const measured = pageHeights.get(page)
    const scrollKey = `${scrollToPageAt}:${page}:${measured ?? "est"}`
    if (lastScrollKeyRef.current === scrollKey) return
    lastScrollKeyRef.current = scrollKey

    const root = scrollRef.current
    if (!root) return

    let top = 0
    for (let p = 1; p < page; p++) {
      top += pageHeights.get(p) ?? defaultPageHeight(layoutWidth)
    }

    programmaticScrollUntilRef.current = Date.now() + 1400
    anchorPageRef.current = page
    root.scrollTo({ top, behavior: "auto" })
    onPageChangeRef.current?.(page, numPages)
    const start = Math.max(1, page - WINDOW_BEFORE)
    const end = Math.min(numPages, page + WINDOW_AFTER)
    setPageWindow({ start, end })
  }, [layoutWidth, numPages, pageHeights, scrollToPage, scrollToPageAt])

  // The initial window is a fixed guess (1..8) made before numPages is known, so
  // clamp it — a 1-page PDF was asking pdf.js for pages 2-8 and logging
  // "Invalid page request" for each one.
  const windowStart = Math.max(1, pageWindow.start)
  const windowEnd = numPages > 0 ? Math.min(pageWindow.end, numPages) : pageWindow.end
  const highlightsForRender = highlightTargets?.length ? pageHighlights : EMPTY_PAGE_HIGHLIGHTS
  const topSpacer = windowStart > 1 ? offsetBefore(windowStart) : 0
  const bottomSpacer =
    windowEnd < numPages ? totalScrollHeight - offsetBefore(windowEnd + 1) : 0

  if (loading) {
    return (
      <div ref={scrollRef} className="h-full min-h-0 w-full bg-zinc-50">
        <PdfPreviewLoading />
      </div>
    )
  }

  if (error || !pdfDoc) {
    return (
      <p className="px-4 text-center text-sm text-muted-foreground">{error ?? "Preview unavailable"}</p>
    )
  }

  const pdf = pdfDoc

  return (
    <div
      ref={scrollRef}
      className={cn(
        "scrollbar-hide h-full min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-y-contain bg-zinc-50",
      )}
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      <div className="mx-auto flex w-full flex-col items-center px-4 py-4">
        {topSpacer > 0 ? <div style={{ height: topSpacer, width: "100%" }} aria-hidden /> : null}
        {Array.from({ length: windowEnd - windowStart + 1 }, (_, i) => windowStart + i).map(
          (pageNumber) => (
            <PdfPageCanvas
              key={pageNumber}
              pdf={pdf}
              pageNumber={pageNumber}
              layoutWidth={layoutWidth}
              renderWidth={renderWidth}
              numPages={numPages}
              onHeight={onHeight}
              highlightRects={highlightsForRender.get(pageNumber)}
            />
          ),
        )}
        {bottomSpacer > 0 ? <div style={{ height: bottomSpacer, width: "100%" }} aria-hidden /> : null}
      </div>
    </div>
  )
}
