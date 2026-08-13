import { Suspense } from "react"

import {
  AuthHeroPanel,
  AuthLightLegalFooter,
  AuthLightPageHeader,
} from "@/components/auth/auth-light"
import { AuthRouteGuard } from "@/components/auth/auth-route-guard"
import { SetupForm } from "@/components/auth/setup-form"
import { SetupHeroShowcase } from "@/components/auth/setup-hero-showcase"

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
 * Balanced setup shell:
 * - LEFT: original thick orange panel + login-matched dashboard preview
 * - RIGHT: form floats on the canvas (no nested white card box)
 */
function SetupPageShell() {
  return (
    <main className="relative flex h-svh max-h-svh overflow-hidden bg-[#f7f7f7] text-[#222222]">
      {/* Left inset: p-5 matches right column outer inset */}
      <section className="relative z-0 hidden h-full lg:flex lg:w-[48%] xl:w-[45%] lg:p-5">
        <AuthHeroPanel fill>
          <SetupHeroShowcase />
        </AuthHeroPanel>
      </section>

      {/* Same outer p-5 so Continue / legal sit as low as the hero panel */}
      <section className="relative z-0 flex h-full min-h-0 w-full flex-col overflow-hidden px-6 py-5 sm:px-10 lg:w-[52%] lg:px-5 lg:py-5 xl:w-[55%]">
        <header className="relative z-10 shrink-0 px-0 sm:px-2 lg:px-11">
          <div className="flex h-10 items-center justify-between sm:h-11">
            <div className="lg:hidden">
              <AuthLightPageHeader contextLabel="First-run setup" />
            </div>
            <div className="hidden text-xs text-[#a0a0a0] lg:block">
              Private instance configuration
            </div>
          </div>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-0 sm:px-2 lg:px-11">
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

        <AuthLightLegalFooter className="shrink-0 border-t-0 px-0 pt-2 pb-0 sm:px-2 lg:px-11" />
      </section>
    </main>
  )
}
