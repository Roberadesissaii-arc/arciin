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
 * Left and right share the same outer inset (`p-5` / `1.25rem`).
 * Continue / “Locks after claim” are the last block on the right so their
 * bottom edge lines up with the orange hero panel bottom.
 */
function SetupPageShell() {
  return (
    <main className="relative flex h-svh max-h-svh overflow-hidden bg-[#f7f7f7] text-[#222222]">
      <section className="relative z-0 hidden h-full min-h-0 lg:flex lg:w-[48%] xl:w-[45%] lg:p-5">
        <AuthHeroPanel fill>
          <SetupHeroShowcase />
        </AuthHeroPanel>
      </section>

      <section className="relative z-0 flex h-full min-h-0 w-full flex-col overflow-hidden p-5 sm:p-6 lg:w-[52%] lg:p-5 xl:w-[55%]">
        <header className="relative z-10 flex shrink-0 items-center justify-between gap-4 px-1 sm:px-2 lg:px-8">
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

        {/*
          Form fills remaining height. Actions stay at the bottom of this
          section — section already has p-5, so no extra footer under them.
        */}
        <div className="relative z-10 mt-4 flex min-h-0 flex-1 flex-col px-1 sm:px-2 lg:mt-5 lg:px-8">
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
