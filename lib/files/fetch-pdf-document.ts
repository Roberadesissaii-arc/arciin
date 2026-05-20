import type { PDFDocumentProxy } from "pdfjs-dist"

let pdfjsInit: Promise<typeof import("pdfjs-dist")> | null = null

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

export async function fetchPdfDocument(fileUrl: string): Promise<PDFDocumentProxy> {
  const pdfjsLib = await loadPdfJs()
  return pdfjsLib.getDocument({
    url: fileUrl,
    withCredentials: true,
    disableAutoFetch: true,
    disableStream: true,
  }).promise
}
