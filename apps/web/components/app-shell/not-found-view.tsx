import Link from "next/link"

import { NotFoundActions } from "@/app/not-found-actions"

function NotFoundHero() {
  return (
    <p className="font-heading text-6xl font-bold tracking-[-0.04em] text-zinc-400 sm:text-7xl md:text-8xl">
      404
    </p>
  )
}

function NotFoundCenteredBlock() {
  return (
    <div className="relative z-10 flex w-full max-w-lg flex-col items-center text-center">
      <div className="mb-5 sm:mb-6">
        <NotFoundHero />
      </div>

      <h1 className="mb-2 text-[22px] font-bold tracking-tight text-zinc-900">Page not found</h1>
      <p className="mb-10 max-w-md text-[15px] leading-relaxed text-zinc-600">
        The page you&apos;re looking for doesn&apos;t exist or has been moved. Head home and we&apos;ll route you
        to the right place.
      </p>

      <NotFoundActions />

      <p className="mt-12 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Arciin</p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
        <Link
          href="/legal/privacy"
          className="text-[12px] font-medium text-zinc-600 underline-offset-4 transition-colors hover:text-primary hover:underline"
        >
          Privacy
        </Link>
        <Link
          href="/legal/terms"
          className="text-[12px] font-medium text-zinc-600 underline-offset-4 transition-colors hover:text-primary hover:underline"
        >
          Terms
        </Link>
      </div>
    </div>
  )
}

const dashboardScrollBleed =
  "-mx-3 -my-4 flex min-h-0 w-[calc(100%+1.5rem)] flex-1 flex-col sm:-mx-4 sm:w-[calc(100%+2rem)] lg:-mx-5 lg:w-[calc(100%+2.5rem)]"

/**
 * Embedded: light panel inside the dashboard main column.
 * Fullscreen: light page with centered card (readable without the dark auth chrome).
 */
export function NotFoundView({ variant }: { variant: "fullscreen" | "embedded" }) {
  if (variant === "embedded") {
    return (
      <div className={dashboardScrollBleed}>
        <div className="relative flex min-h-[calc(100dvh-6.5rem)] flex-1 flex-col items-center justify-center overflow-hidden rounded-3xl border border-zinc-200/95 bg-gradient-to-b from-zinc-50 via-white to-zinc-100 px-6 py-16 shadow-sm ring-1 ring-black/[0.04] sm:min-h-[calc(100dvh-7rem)]">
          <div
            className="pointer-events-none absolute inset-0 opacity-90"
            aria-hidden
            style={{
              background:
                "radial-gradient(ellipse 75% 55% at 50% -15%, rgba(255,79,18,0.12) 0%, transparent 55%)",
            }}
          />
          <NotFoundCenteredBlock />
        </div>
      </div>
    )
  }

  return (
    <main className="relative min-h-svh bg-zinc-100">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(255,79,18,0.08) 0%, transparent 50%)",
        }}
      />
      <div className="relative mx-auto flex min-h-svh max-w-[520px] flex-col items-center justify-center px-5 py-16 sm:px-8">
        <div className="w-full rounded-3xl border border-zinc-200/95 bg-white/95 px-8 py-14 shadow-[0_24px_80px_-28px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.05] backdrop-blur-sm sm:px-12 sm:py-16">
          <NotFoundCenteredBlock />
        </div>
      </div>
    </main>
  )
}
