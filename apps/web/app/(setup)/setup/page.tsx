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
 * Original setup proportions:
 * - LEFT: thick orange AuthHeroPanel (rounded-[28px], inset padding) + image + dots
 * - RIGHT: claim form column
 * Viewport locked — no page scroll.
 */
function SetupPageShell() {
  return (
    <main className="relative flex h-svh max-h-svh overflow-hidden bg-[#f7f7f7] text-[#222222]">
      {/* Left — original hero container size/thickness */}
      <section className="relative z-0 hidden h-full lg:flex lg:w-[48%] xl:w-[45%] lg:p-5">
        <AuthHeroPanel fill>
          <SetupHeroShowcase />
        </AuthHeroPanel>
      </section>

      {/* Right — 3-step form, fills height without page scroll */}
      <section className="relative z-0 flex h-full min-h-0 w-full flex-col overflow-hidden lg:w-[52%] xl:w-[55%]">
        <header className="relative z-10 shrink-0 px-6 sm:px-10 lg:px-14">
          <div className="flex h-14 items-center justify-between">
            <div className="lg:hidden">
              <AuthLightPageHeader contextLabel="First-run setup" />
            </div>
            <div className="hidden text-xs text-[#a0a0a0] lg:block">
              Private instance configuration
            </div>
          </div>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-2 sm:px-10 lg:px-14">
          <div className="mx-auto flex h-full min-h-0 w-full max-w-xl flex-col">
            <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-[#efefef] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:px-7 sm:py-6">
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
        </div>

        <AuthLightLegalFooter className="border-t-0 px-6 py-3 sm:px-10 lg:px-14" />
      </section>
    </main>
  )
}
