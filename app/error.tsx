"use client"

import Link from "next/link"
import { useEffect } from "react"
import { Home, RotateCcw } from "lucide-react"

import {
  InstanceAuthAtmosphere,
  InstanceAuthPanel,
} from "@/components/auth/instance-auth-chrome"
import { Button } from "@/components/ui/button"

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
    <main className="relative flex min-h-svh bg-background">
      <InstanceAuthAtmosphere />
      <div className="relative z-0 mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10 sm:px-6">
        <InstanceAuthPanel className="flex min-h-[min(72svh,46rem)] w-full flex-col sm:min-h-[min(68svh,42rem)]">
          <div className="relative z-10 flex flex-col items-center px-6 py-16 text-center sm:px-12 sm:py-20">
            <p className="font-heading text-6xl font-semibold tracking-[-0.04em] text-white/95 sm:text-7xl">
              500
            </p>
            <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">Error</p>

            <h2 className="font-heading mt-8 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Something went wrong
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-zinc-400">
              An unexpected error occurred. Try again or go home and we&apos;ll pick up from there.
            </p>

            {detail ? (
              <p
                className="mt-6 max-w-lg truncate rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 font-mono text-[11px] text-zinc-400"
                title={detail}
              >
                {detail}
              </p>
            ) : null}

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Button
                type="button"
                onClick={reset}
                className="inline-flex items-center gap-2 bg-primary px-6 text-white shadow-[0_0_36px_rgba(255,75,51,0.16)] hover:bg-primary/90"
              >
                <RotateCcw className="size-4" />
                Try again
              </Button>
              <Button
                asChild
                variant="outline"
                className="border-white/[0.12] bg-white/[0.03] text-zinc-200 hover:bg-white/[0.06]"
              >
                <Link href="/" className="inline-flex items-center gap-2">
                  <Home className="size-4" />
                  Go home
                </Link>
              </Button>
            </div>

            <p className="mt-16 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-600">Arciin</p>
          </div>
        </InstanceAuthPanel>
      </div>
    </main>
  )
}
