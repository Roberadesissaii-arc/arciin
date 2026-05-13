"use client"

import Link from "next/link"
import { useEffect } from "react"
import { Home, RotateCcw } from "lucide-react"

const PARTICLES = [
  { id: 0, x: 8, y: 12, size: 2, delay: 0 },
  { id: 1, x: 22, y: 78, size: 1.5, delay: 1.2 },
  { id: 2, x: 38, y: 33, size: 2.5, delay: 0.6 },
  { id: 3, x: 55, y: 88, size: 1, delay: 2.1 },
  { id: 4, x: 67, y: 22, size: 2, delay: 0.3 },
  { id: 5, x: 80, y: 61, size: 1.5, delay: 1.7 },
  { id: 6, x: 92, y: 44, size: 2, delay: 0.9 },
  { id: 7, x: 14, y: 55, size: 1, delay: 2.5 },
  { id: 8, x: 47, y: 6, size: 2.5, delay: 1.4 },
  { id: 9, x: 73, y: 91, size: 1.5, delay: 0.7 },
  { id: 10, x: 30, y: 70, size: 1, delay: 3.1 },
  { id: 11, x: 85, y: 15, size: 2, delay: 1.9 },
]

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  const detail = error?.digest ? `${error.message || "Error"} (${error.digest})` : error?.message

  return (
    <div
      className="relative flex min-h-[100dvh] select-none flex-col items-center justify-center overflow-hidden"
      style={{ background: "#09090B" }}
    >
      <style>{`
        @keyframes arciinFloatUp {
          0%   { transform: translateY(0px) scale(1);   opacity: 0.35; }
          100% { transform: translateY(-20px) scale(1.4); opacity: 0.08; }
        }
      `}</style>

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(255,79,18,0.1) 0%, transparent 70%)",
        }}
      />

      {PARTICLES.map((p) => (
        <div
          key={p.id}
          className="pointer-events-none absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            background: "rgba(255,100,55,0.42)",
            animation: `arciinFloatUp 5s ease-in-out ${p.delay}s infinite alternate`,
          }}
        />
      ))}

      <div className="relative z-10 flex max-w-lg flex-col items-center px-6 text-center">
        <div className="relative mb-4" style={{ lineHeight: 1 }}>
          <p
            className="text-[120px] font-black tracking-tighter"
            style={{
              color: "transparent",
              WebkitTextStroke: "1px rgba(255,255,255,0.06)",
              userSelect: "none",
              lineHeight: 1,
            }}
          >
            500
          </p>
          <p
            className="absolute inset-0 text-[120px] font-black tracking-tighter"
            style={{
              color: "transparent",
              background:
                "linear-gradient(135deg, #FF9A6B 0%, #FF4F12 55%, rgba(255,79,18,0.22) 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              userSelect: "none",
              lineHeight: 1,
            }}
          >
            500
          </p>
        </div>

        <h1 className="mb-2 text-[22px] font-bold tracking-tight text-white">Something went wrong</h1>
        <p className="mb-4 text-[14px] leading-relaxed" style={{ color: "rgba(255,255,255,0.38)" }}>
          An unexpected error occurred. Try again or go home and we&apos;ll pick up from there.
        </p>

        {detail ? (
          <p
            className="mb-10 max-w-sm truncate rounded-xl px-4 py-2.5 font-mono text-[11px]"
            style={{
              background: "rgba(255,79,18,0.08)",
              border: "1px solid rgba(255,79,18,0.18)",
              color: "rgba(255,176,143,0.85)",
            }}
            title={detail}
          >
            {detail}
          </p>
        ) : (
          <div className="mb-10" />
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-85"
            style={{ background: "#FF4F12" }}
          >
            <RotateCcw className="h-4 w-4" />
            Try again
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-85"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.09)",
              color: "rgba(255,255,255,0.6)",
            }}
          >
            <Home className="h-4 w-4" />
            Go home
          </Link>
        </div>

        <p
          className="mt-14 text-[11px] font-medium uppercase"
          style={{ color: "rgba(255,255,255,0.13)", letterSpacing: "0.25em" }}
        >
          Arciin
        </p>
      </div>
    </div>
  )
}
