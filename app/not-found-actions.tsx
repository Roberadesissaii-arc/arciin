"use client"

import Link from "next/link"
import { ArrowLeft, Home } from "lucide-react"

export function NotFoundActions() {
  return (
    <div className="flex items-center gap-3">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-85"
        style={{ background: "#FF4F12" }}
      >
        <Home className="h-4 w-4" />
        Go home
      </Link>
      <button
        type="button"
        onClick={() => history.back()}
        className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-85"
        style={{
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.09)",
          color: "rgba(255,255,255,0.6)",
        }}
      >
        <ArrowLeft className="h-4 w-4" />
        Go back
      </button>
    </div>
  )
}
