import Link from "next/link"
import { ShieldCheck } from "lucide-react"

import { AUTH_HERO_GRADIENT } from "@/components/auth/auth-light"
import { LoginForm } from "@/components/auth/login-form"
import { LoginHeroShowcase } from "@/components/auth/login-hero-showcase"
import { ArciinMarkLetter } from "@/components/ui/arciin-icon"

export function LoginPageShell() {
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

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
            <div className="w-full max-w-sm">
              <div>
                <h1 className="text-center font-heading text-[28px] font-bold tracking-tight text-[#111111]">
                  Welcome Back
                </h1>
                <p className="mt-2 text-left text-[13px] leading-relaxed text-[#a0a0a0]">
                  Use the email and password for this Arciin instance. Need to claim the
                  server first?{" "}
                  <Link
                    href="/setup"
                    className="font-medium text-[#ff4f12] underline-offset-4 hover:underline"
                  >
                    Start setup
                  </Link>
                  .
                </p>
              </div>

              <div className="mt-8">
                <LoginForm />
              </div>

              <p className="mt-7 flex items-center justify-center gap-1.5 text-center text-[12px] text-[#a0a0a0]">
                <ShieldCheck className="size-3.5 shrink-0 text-[#ff4f12]" />
                Private by design — your account and files stay on this server.
              </p>
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
