import type { PDFDocumentProxy } from "pdfjs-dist"

let pdfjsInit: Promise<typeof import("pdfjs-dist")> | null = null

function pdfJsWasmUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/pdfjs-wasm/`
  }
  return "/pdfjs-wasm/"
}

export function loadPdfJs() {
  if (!pdfjsInit) {
    pdfjsInit = import("pdfjs-dist").then((pdfjsLib) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString()
      return pdfjsLib
    })
  }
  return pdfjsInit
}

export type PdfDocumentSource =
  | { url: string; withCredentials?: boolean }
  | { data: Uint8Array }

export async function openPdfDocument(source: PdfDocumentSource) {
  const pdfjsLib = await loadPdfJs()
  const wasmUrl = pdfJsWasmUrl()
  const base = {
    wasmUrl,
    useWasm: true,
    useWorkerFetch: true,
    disableRange: false,
    disableAutoFetch: false,
    disableStream: false,
  }

  if ("url" in source) {
    return pdfjsLib.getDocument({
      ...base,
      url: source.url,
      withCredentials: source.withCredentials ?? true,
    })
  }

  return pdfjsLib.getDocument({
    ...base,
    data: source.data,
  })
}

type CachedPdf = { pdf: PDFDocumentProxy; refs: number }

const pdfDocumentCache = new Map<string, CachedPdf>()

export async function fetchPdfDocument(fileUrl: string): Promise<PDFDocumentProxy> {
  const hit = pdfDocumentCache.get(fileUrl)
  if (hit) {
    hit.refs += 1
    return hit.pdf
  }

  const task = await openPdfDocument({ url: fileUrl, withCredentials: true })
  const pdf = await task.promise
  pdfDocumentCache.set(fileUrl, { pdf, refs: 1 })
  return pdf
}

export function hasPdfDocumentCache(fileUrl: string) {
  return pdfDocumentCache.has(fileUrl)
}

export function getCachedPdfDocument(fileUrl: string): PDFDocumentProxy | null {
  return pdfDocumentCache.get(fileUrl)?.pdf ?? null
}

/** Pair with fetchPdfDocument when a viewer unmounts so reopening preview stays instant. */
export function releasePdfDocument(fileUrl: string) {
  const hit = pdfDocumentCache.get(fileUrl)
  if (!hit) return
  hit.refs -= 1
  if (hit.refs <= 0) {
    pdfDocumentCache.delete(fileUrl)
    // pdf.js 6 removed PDFDocumentProxy.destroy(); the loading task owns teardown.
    void hit.pdf.loadingTask.destroy()
  }
}
