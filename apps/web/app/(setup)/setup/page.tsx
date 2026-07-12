import { redirect } from "next/navigation"
import { Suspense } from "react"

import {
  AuthHeroPanel,
  AuthLightLegalFooter,
  AuthLightPageHeader,
} from "@/components/auth/auth-light"
import { SetupForm } from "@/components/auth/setup-form"
import { SetupHeroCopy } from "@/components/auth/setup-hero-copy"
import { AccessDeniedScreen } from "@/components/app-shell/access-denied-screen"
import { SystemUnavailable } from "@/components/app-shell/system-unavailable"
import { getRootRouteState } from "@/lib/utils/route-guards"

export const dynamic = "force-dynamic"

export default async function SetupPage() {
  const state = await getRootRouteState()

  if (state.kind === "authenticated") {
    redirect("/dashboard")
  }

  if (state.kind === "unauthenticated") {
    redirect("/login")
  }

  if (state.kind === "unavailable") {
    return (
      <SystemUnavailable
        contextLabel="Setup"
        title="Setup is waiting for the instance service."
        description="The claim screen is ready, but Arciin cannot verify setup state until the API is available."
      />
    )
  }

  if (state.kind === "ip-forbidden") {
    return (
      <AccessDeniedScreen
        theme="light"
        contextLabel="Setup"
        message={state.message}
        instanceName={state.instance.instanceName}
      />
    )
  }

  return (
    <main className="relative flex h-svh max-h-svh overflow-hidden bg-[#f7f7f7] text-[#222222]">
      <section className="relative z-0 hidden h-full lg:flex lg:w-[48%] xl:w-[45%] lg:p-5">
        <AuthHeroPanel>
          <SetupHeroCopy />
        </AuthHeroPanel>
      </section>

      <section className="relative z-0 flex h-full min-h-0 w-full flex-col overflow-hidden lg:w-[52%] xl:w-[55%]">
        <header className="relative z-10 shrink-0 px-6 sm:px-10 lg:px-16">
          <div className="flex h-16 items-center justify-between">
            <div className="lg:hidden">
              <AuthLightPageHeader contextLabel="First-run setup" />
            </div>
            <div className="hidden text-xs text-[#a0a0a0] lg:block">
              Private instance configuration
            </div>
          </div>
        </header>

        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-6 py-4 sm:px-10 sm:py-5 lg:px-16 lg:py-6">
          <div className="mx-auto w-full max-w-xl py-2">
            <div className="rounded-3xl border border-[#efefef] bg-white px-6 py-6 shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:px-8 sm:py-8">
              <Suspense fallback={<div className="text-sm text-[#a0a0a0]">Loading setup…</div>}>
                <SetupForm />
              </Suspense>
            </div>
          </div>
        </div>

        <AuthLightLegalFooter />
      </section>
    </main>
  )
}
