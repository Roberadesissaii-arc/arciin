import Link from "next/link"
import { redirect } from "next/navigation"

import { AUTH_HERO_GRADIENT } from "@/components/auth/auth-light"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"
import { LoginHeroShowcase } from "@/components/auth/login-hero-showcase"
import { AccessDeniedScreen } from "@/components/app-shell/access-denied-screen"
import { SystemUnavailable } from "@/components/app-shell/system-unavailable"
import { ArciinMarkLetter } from "@/components/ui/arciin-icon"
import { getRootRouteState } from "@/lib/utils/route-guards"

export const dynamic = "force-dynamic"

export default async function ForgotPasswordPage() {
  const state = await getRootRouteState()

  if (state.kind === "setup-required") {
    redirect("/setup")
  }

  if (state.kind === "authenticated") {
    redirect("/dashboard")
  }

  if (state.kind === "unavailable") {
    return (
      <SystemUnavailable
        contextLabel="Forgot password"
        title="Password recovery is waiting for the instance service."
        description="Arciin needs the API online before it can look up your security question."
      />
    )
  }

  if (state.kind === "ip-forbidden") {
    return (
      <AccessDeniedScreen
        theme="light"
        contextLabel="Forgot password"
        message={state.message}
        instanceName={state.instance.instanceName}
      />
    )
  }

  return (
    <main className="flex h-svh overflow-hidden bg-white text-[#222222]">
      <div className="flex h-full w-full">
        {/* Left — brand, centered form, copyright footer */}
        <section className="relative flex h-full min-h-0 w-full flex-col px-7 py-6 sm:px-10 lg:w-1/2 lg:px-12">
          <div className="flex shrink-0 items-center gap-2">
            <ArciinMarkLetter size="sm" />
            <span className="font-heading text-[17px] font-bold leading-none tracking-tight text-[#111111]">
              Arciin<span className="text-[#ff4f12]">.</span>
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto">
            <div className="w-full max-w-sm">
              <div>
                <h1 className="text-center font-heading text-[28px] font-bold tracking-tight text-[#111111]">
                  Reset your password
                </h1>
                <p className="mt-2 text-left text-[13px] leading-relaxed text-[#a0a0a0]">
                  Use the email and security question from setup — self-hosted instances
                  cannot send email reset links.
                </p>
              </div>

              <div className="mt-8">
                <ForgotPasswordForm />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-between gap-4">
            <p className="text-[11px] text-[#b3b3b3]">
              Copyright © 2026 Arciin.
            </p>
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

        {/* Right — rounded orange hero panel inset on the white page */}
        <section className="hidden h-full lg:block lg:w-1/2 lg:p-4 lg:pl-0">
          <div
            className="h-full w-full overflow-hidden rounded-[22px]"
            style={{ background: AUTH_HERO_GRADIENT }}
          >
            <LoginHeroShowcase />
          </div>
        </section>
      </div>
    </main>
  )
}
