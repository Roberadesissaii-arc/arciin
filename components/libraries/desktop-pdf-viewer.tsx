"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { PDFDocumentProxy } from "pdfjs-dist"
import { Loader2 } from "lucide-react"

import { fetchPdfDocument } from "@/lib/files/fetch-pdf-document"

/** 100% zoom: one PDF point per CSS pixel (standard PDF “actual size” in the viewer). */
const PDF_VIEW_SCALE = 1

function PdfPageCanvas({
  pdf,
  pageNumber,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null)
  const [rendering, setRendering] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    startedRef.current = false
    setSrc(null)
    setPageSize(null)

    let cancelled = false
    let objectUrl: string | null = null

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || startedRef.current) return
        startedRef.current = true
        setRendering(true)
        void (async () => {
          try {
            const page = await pdf.getPage(pageNumber)
            const cssViewport = page.getViewport({ scale: PDF_VIEW_SCALE })
            const cssWidth = Math.floor(cssViewport.width)
            const cssHeight = Math.floor(cssViewport.height)
            const pixelRatio = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2)
            const renderViewport = page.getViewport({ scale: PDF_VIEW_SCALE * pixelRatio })
            const canvas = document.createElement("canvas")
            canvas.width = Math.floor(renderViewport.width)
            canvas.height = Math.floor(renderViewport.height)
            const ctx = canvas.getContext("2d")
            if (!ctx || cancelled) {
              page.cleanup()
              return
            }
            await page.render({ canvasContext: ctx, viewport: renderViewport, canvas }).promise
            page.cleanup()
            if (cancelled) return
            const blob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob((b) => resolve(b), "image/webp", 0.92),
            )
            if (!blob || cancelled) return
            objectUrl = URL.createObjectURL(blob)
            setPageSize({ width: cssWidth, height: cssHeight })
            setSrc(objectUrl)
          } catch {
            /* best-effort */
          } finally {
            if (!cancelled) setRendering(false)
          }
        })()
      },
      { rootMargin: "240px 0px", threshold: 0.01 },
    )

    observer.observe(host)
    return () => {
      cancelled = true
      observer.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [pageNumber, pdf])

  return (
    <div
      ref={hostRef}
      className="flex justify-center py-2"
      data-pdf-page={pageNumber}
    >
      {src && pageSize ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={pageSize.width}
          height={pageSize.height}
          className="block max-w-none bg-white shadow-md"
          style={{ width: pageSize.width, height: pageSize.height }}
          draggable={false}
        />
      ) : (
        <div
          className="flex items-center justify-center bg-zinc-800 text-[11px] text-muted-foreground"
          style={{
            width: pageSize?.width ?? 612,
            height: pageSize?.height ?? 792,
            minWidth: 280,
            minHeight: 360,
          }}
        >
          {rendering ? <Loader2 className="size-5 animate-spin" /> : `Page ${pageNumber}`}
        </div>
      )}
    </div>
  )
}

export function DesktopPdfViewer({
  fileUrl,
  onPageChange,
}: {
  fileUrl: string
  onPageChange?: (page: number, total: number) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const onPageChangeRef = useRef(onPageChange)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    onPageChangeRef.current = onPageChange
  }, [onPageChange])

  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null

    void (async () => {
      setLoading(true)
      setError(null)
      setNumPages(0)
      setPdfDoc(null)

      try {
        const pdf = await fetchPdfDocument(fileUrl)
        if (cancelled) {
          void pdf.destroy()
          return
        }
        loaded = pdf
        setPdfDoc(pdf)
        setNumPages(pdf.numPages)
        setLoading(false)
        onPageChangeRef.current?.(1, pdf.numPages)
      } catch {
        if (!cancelled) {
          setError("Could not open this PDF.")
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      if (loaded) void loaded.destroy()
    }
  }, [fileUrl])

  const updateVisiblePage = useCallback(() => {
    const root = scrollRef.current
    if (!root || !pdfDoc || pdfDoc.numPages < 1) return
    const pdf = pdfDoc

    const mid = root.scrollTop + root.clientHeight * 0.35
    let best = 1
    let bestDist = Number.POSITIVE_INFINITY
    const nodes = root.querySelectorAll<HTMLElement>("[data-pdf-page]")
    nodes.forEach((node) => {
      const n = Number(node.dataset.pdfPage)
      if (!n) return
      const top = node.offsetTop
      const dist = Math.abs(top - mid)
      if (dist < bestDist) {
        bestDist = dist
        best = n
      }
    })
    onPageChangeRef.current?.(best, pdf.numPages)
  }, [pdfDoc])

  useEffect(() => {
    const root = scrollRef.current
    if (!root || loading) return
    const onScroll = () => updateVisiblePage()
    root.addEventListener("scroll", onScroll, { passive: true })
    updateVisiblePage()
    return () => root.removeEventListener("scroll", onScroll)
  }, [loading, numPages, updateVisiblePage])

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
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
      className="h-full w-full overflow-auto overscroll-contain bg-zinc-900/80"
    >
      <div className="mx-auto flex w-max min-w-full flex-col items-center px-4 py-3">
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
          <PdfPageCanvas key={pageNumber} pdf={pdf} pageNumber={pageNumber} />
        ))}
      </div>
    </div>
  )
}
