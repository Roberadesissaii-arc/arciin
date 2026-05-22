"use client"

import { Loader2 } from "lucide-react"

export function PdfPreviewLoading() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6">
      <Loader2 className="size-7 animate-spin text-zinc-500" aria-hidden />
      <p className="text-[13px] text-zinc-500">Opening PDF…</p>
    </div>
  )
}
