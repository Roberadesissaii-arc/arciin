"use client"

/**
 * Client-side PDF first-page previews (same approach as Arcellite Business).
 * Renders in the browser via PDF.js — does not depend on server ffmpeg jobs.
 */
import { useEffect, useState } from "react"

const memCache = new Map<string, string>()
const MAX_MEM_CACHE = 120

function memSet(key: string, value: string) {
  if (memCache.size >= MAX_MEM_CACHE) {
    const first = memCache.keys().next().value
    if (first) memCache.delete(first)
  }
  memCache.set(key, value)
}

const DB_NAME = "arciin_pdf_thumbnails"
const STORE = "pdf_thumbs"
const DB_VERSION = 1

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<string | undefined> {
  try {
    const db = await openDb()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result as string | undefined)
      req.onerror = () => resolve(undefined)
    })
  } catch {
    return undefined
  }
}

async function idbSet(key: string, value: string): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(value, key)
  } catch {
    /* optional cache */
  }
}

const renderQueue: (() => Promise<void>)[] = []
let activeRenders = 0
const MAX_CONCURRENT = 2

function drainQueue() {
  while (activeRenders < MAX_CONCURRENT && renderQueue.length > 0) {
    const job = renderQueue.shift()!
    activeRenders++
    job().finally(() => {
      activeRenders--
      drainQueue()
    })
  }
}

function enqueueRender(fn: () => Promise<void>) {
  renderQueue.push(fn)
  drainQueue()
}

let pdfjsInit: Promise<typeof import("pdfjs-dist")> | null = null

function loadPdfJs() {
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

async function renderPdfThumbDataUrl(fileUrl: string): Promise<string | null> {
  const pdfjsLib = await loadPdfJs()
  const pdf = await pdfjsLib.getDocument({
    url: fileUrl,
    disableAutoFetch: true,
    disableStream: true,
    withCredentials: true,
  }).promise

  try {
    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    const targetWidth = 320
    const scale = targetWidth / viewport.width
    const scaledViewport = page.getViewport({ scale })

    const canvas = document.createElement("canvas")
    canvas.width = Math.floor(scaledViewport.width)
    canvas.height = Math.floor(scaledViewport.height)
    const ctx = canvas.getContext("2d")
    if (!ctx) return null

    await page.render({ canvasContext: ctx, viewport: scaledViewport, canvas }).promise
    const dataUrl = canvas.toDataURL("image/webp", 0.78)
    page.cleanup()
    return dataUrl
  } finally {
    await pdf.destroy()
  }
}

export function usePdfThumbnail(fileUrl: string | undefined, enabled: boolean): string | null {
  const [thumb, setThumb] = useState<string | null>(
    fileUrl && memCache.has(fileUrl) ? memCache.get(fileUrl)! : null,
  )

  useEffect(() => {
    if (!enabled || !fileUrl) return

    if (memCache.has(fileUrl)) {
      setThumb(memCache.get(fileUrl)!)
      return
    }

    let cancelled = false

    void (async () => {
      const cached = await idbGet(fileUrl)
      if (cached) {
        memSet(fileUrl, cached)
        if (!cancelled) setThumb(cached)
        return
      }

      await new Promise<void>((resolve) => {
        enqueueRender(async () => {
          try {
            const dataUrl = await renderPdfThumbDataUrl(fileUrl)
            if (dataUrl) {
              memSet(fileUrl, dataUrl)
              await idbSet(fileUrl, dataUrl)
              if (!cancelled) setThumb(dataUrl)
            }
          } catch {
            /* best-effort */
          }
          resolve()
        })
      })
    })()

    return () => {
      cancelled = true
    }
  }, [fileUrl, enabled])

  return thumb
}

export function pdfThumbnailSourceKey(assetId: string, updatedAt: string) {
  return `/api/assets/${assetId}/download?inline=1&v=${encodeURIComponent(updatedAt)}`
}
