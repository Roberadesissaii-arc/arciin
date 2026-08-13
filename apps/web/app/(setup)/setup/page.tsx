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
      <section className="relative z-0 hidden h-full lg:flex lg:w-[48%] xl:w-[45%] lg:p-5">
        <AuthHeroPanel fill>
          <SetupHeroShowcase />
        </AuthHeroPanel>
      </section>

      <section className="relative z-0 flex h-full min-h-0 w-full flex-col overflow-hidden lg:w-[52%] xl:w-[55%] lg:py-5">
        <header className="relative z-10 shrink-0 px-6 sm:px-10 lg:px-16">
          <div className="flex h-12 items-center justify-between lg:h-10">
            <div className="lg:hidden">
              <AuthLightPageHeader contextLabel="First-run setup" />
            </div>
            <div className="hidden text-xs text-[#a0a0a0] lg:block">
              Private instance configuration
            </div>
          </div>
        </header>

        {/* Floating form — bottom inset matches left hero section p-5 */}
        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-6 sm:px-10 lg:px-16">
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

        <AuthLightLegalFooter className="shrink-0 border-t-0 px-6 pt-1 pb-5 sm:px-10 lg:px-16 lg:pb-0" />
      </section>
    </main>
  )
}
