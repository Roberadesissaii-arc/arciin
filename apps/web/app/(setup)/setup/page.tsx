import { Suspense } from "react"
import Link from "next/link"

import {
  AuthHeroPanel,
  AuthLightPageHeader,
} from "@/components/auth/auth-light"
import { AuthRouteGuard } from "@/components/auth/auth-route-guard"
import { SetupForm } from "@/components/auth/setup-form"
import { SetupHeroShowcase } from "@/components/auth/setup-hero-showcase"

export const dynamic = "force-dynamic"

/** Shared outer inset — same distance from viewport edges as left orange panel. */
const SETUP_INSET = "p-5" // 1.25rem all sides

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
 * Measurement model (desktop):
 * - Viewport: 100svh, no page scroll
 * - Left:  [inset][orange panel fills][inset]
 * - Right: [inset][header + form + actions fill][inset]
 * - Actions are the last block on the right → same bottom inset as the panel
 * - Privacy/Terms live in the header (same column, no second bottom container)
 */
function SetupPageShell() {
  return (
    <main className="relative flex h-svh max-h-svh overflow-hidden bg-[#f7f7f7] text-[#222222]">
      <section
        className={`relative z-0 hidden h-full min-h-0 lg:flex lg:w-[48%] xl:w-[45%] ${SETUP_INSET}`}
      >
        <AuthHeroPanel fill>
          <SetupHeroShowcase />
        </AuthHeroPanel>
      </section>

      <section
        className={`relative z-0 flex h-full min-h-0 w-full flex-col overflow-hidden lg:w-[52%] xl:w-[55%] ${SETUP_INSET}`}
      >
        <header className="relative z-10 flex shrink-0 items-center justify-between gap-4">
          <div className="lg:hidden">
            <AuthLightPageHeader contextLabel="First-run setup" />
          </div>
          <p className="hidden text-xs text-[#a0a0a0] lg:block">
            Private instance configuration
          </p>
          <div className="flex items-center gap-4">
            <Link
              href="/legal/privacy"
              className="text-[11px] text-[#a0a0a0] underline-offset-4 transition-colors hover:text-[#555555] hover:underline"
            >
              Privacy
            </Link>
            <Link
              href="/legal/terms"
              className="text-[11px] text-[#a0a0a0] underline-offset-4 transition-colors hover:text-[#555555] hover:underline"
            >
              Terms
            </Link>
          </div>
        </header>

        <div className="relative z-10 mt-5 flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-lg flex-col">
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
      </section>
    </main>
  )
}
