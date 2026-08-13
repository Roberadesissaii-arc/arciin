"use client"

import Link from "next/link"
import { useEffect } from "react"
import { Home, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * The 500 page.
 *
 * No card. A panel floating mid-screen frames the failure as a component of the
 * app that is still working, which is exactly the wrong impression — the app is
 * not working, and the honest presentation is a bare page. The numeral does the
 * work instead: set very large, hollow, and cropped by the viewport so it reads
 * as a graphic rather than as text that happens to be big.
 *
 * The red wash is gone with it. Every surface in Arciin is dark and the accent
 * is orange, so an orange-lit error page looks like the product rather than like
 * something going wrong; graphite reads as a stopped state and leaves the accent
 * for the one thing worth pressing.
 */
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
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-[#09090B]">
      {/* The numeral, treated as artwork: outlined, oversized, and bled off the
          bottom edge so the page feels cropped rather than centred in a box. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-[-14vh] flex select-none justify-center"
      >
        <span
          className="font-heading text-[46vw] font-bold leading-none tracking-[-0.05em] text-transparent sm:text-[34vw] lg:text-[26rem]"
          style={{
            WebkitTextStroke: "1px rgba(255,255,255,0.07)",
          }}
        >
          500
        </span>
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-center px-6 py-16 sm:px-12 lg:px-20">
        <div className="max-w-xl">
          <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-zinc-600">
            Error 500
          </p>

          <h1 className="font-heading mt-5 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Something went wrong
          </h1>

          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-zinc-400">
            This one is on the server, not on you. Try again — if it keeps happening, the detail
            below is what to send.
          </p>

          {detail ? (
            <p
              className="mt-8 max-w-lg truncate border-l-2 border-zinc-800 pl-4 font-mono text-[11px] leading-relaxed text-zinc-500"
              title={detail}
            >
              {detail}
            </p>
          ) : null}

          <div className="mt-10 flex flex-wrap items-center gap-3">
            {/* The accent lands on the one action worth taking, and nowhere else. */}
            <Button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-2 bg-primary px-6 text-white hover:bg-primary/90"
            >
              <RotateCcw className="size-4" />
              Try again
            </Button>
            <Button
              asChild
              variant="ghost"
              className="text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            >
              <Link href="/" className="inline-flex items-center gap-2">
                <Home className="size-4" />
                Go home
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <p className="relative z-10 px-6 pb-8 text-[11px] font-medium uppercase tracking-[0.3em] text-zinc-700 sm:px-12 lg:px-20">
        Arciin
      </p>
    </main>
  )
}
