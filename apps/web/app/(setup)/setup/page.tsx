import { Suspense } from "react"
import Link from "next/link"

import { AUTH_HERO_GRADIENT } from "@/components/auth/auth-light"
import { AuthRouteGuard } from "@/components/auth/auth-route-guard"
import { SetupForm } from "@/components/auth/setup-form"
import { SetupHeroShowcase } from "@/components/auth/setup-hero-showcase"
import { ArciinMarkLetter } from "@/components/ui/arciin-icon"

export const dynamic = "force-dynamic"

export default function SetupPage() {
  return (
    <AuthRouteGuard
      contextLabel="Setup"
      unavailableTitle="Setup is waiting for the instance service."
      unavailableDescription="The claim screen is ready, but Arciin cannot verify setup state until the API is available."
      redirects={{ authenticated: "/dashboard", unauthenticated: "/login" }}
    >
      <SetupPageShell />
    </AuthRouteGuard>
  )
}

/**
 * Mirrors the login shell:
 * - Left: form column (viewport-locked, no page scroll)
 * - Right: orange rounded panel with the same dashboard preview image as login
 */
function SetupPageShell() {
  return (
    <main className="flex h-svh max-h-svh overflow-hidden bg-white text-[#222222]">
      <div className="flex h-full w-full">
        {/* Left — multi-step claim form */}
        <section className="relative flex h-full min-h-0 w-full flex-col px-6 py-5 sm:px-10 sm:py-6 lg:w-1/2 lg:px-12 lg:py-6">
          <div className="flex shrink-0 items-center gap-2">
            <ArciinMarkLetter size="sm" />
            <span className="font-heading text-[17px] font-bold leading-none tracking-tight text-[#111111]">
              Arciin<span className="text-[#ff4f12]">.</span>
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col justify-center py-3">
            <div className="mx-auto flex h-full max-h-[40rem] min-h-0 w-full max-w-md flex-col">
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center text-sm text-[#a0a0a0]">
                    Loading setup…
                  </div>
                }
              >
                <SetupForm />
              </Suspense>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-4">
            <p className="text-[11px] text-[#b3b3b3]">Copyright © 2026 Arciin.</p>
            <div className="flex items-center gap-4">
              <Link
                href="/legal/privacy"
                className="text-[11px] text-[#a0a0a0] underline-offset-4 transition-colors hover:text-[#555555] hover:underline"
              >
                Privacy Policy
              </Link>
              <Link
                href="/legal/terms"
                className="text-[11px] text-[#a0a0a0] underline-offset-4 transition-colors hover:text-[#555555] hover:underline"
              >
                Terms
              </Link>
            </div>
          </div>
        </section>

        {/* Right — same orange container + dashboard image as /login */}
        <section className="hidden h-full lg:block lg:w-1/2 lg:p-4 lg:pl-0">
          <div
            className="h-full w-full overflow-hidden rounded-[22px]"
            style={{ background: AUTH_HERO_GRADIENT }}
          >
            <SetupHeroShowcase />
          </div>
        </section>
      </div>
    </main>
  )
}
