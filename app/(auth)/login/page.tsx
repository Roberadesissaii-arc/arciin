import Link from "next/link"
import { redirect } from "next/navigation"

import { LoginForm } from "@/components/auth/login-form"
import { LoginHeroCopy } from "@/components/auth/login-hero-copy"
import { SystemUnavailable } from "@/components/app-shell/system-unavailable"
import { getRootRouteState } from "@/lib/utils/route-guards"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
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
        title="Sign-in is waiting for the instance service."
        description="Arciin needs the API online before it can verify sessions or authenticate the owner account."
      />
    )
  }

  return (
    <main className="relative flex min-h-svh bg-background">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_75%_at_100%_0%,rgba(255,75,51,0.22),transparent_55%),radial-gradient(ellipse_60%_50%_at_96%_6%,rgba(255,120,90,0.1),transparent_48%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,75,51,0.07)_0%,transparent_42%)]"
        aria-hidden
      />

      <section className="relative z-0 hidden lg:flex lg:w-[48%] xl:w-[45%] lg:p-5">
        <div className="relative flex-1 overflow-hidden rounded-[28px] border border-white/[0.07] bg-background shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,75,51,0.12)_0%,rgba(9,9,11,0.06)_28%,rgba(9,9,11,0.35)_55%,transparent_100%)]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -top-32 left-1/2 aspect-[1.35] w-[min(92%,520px)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_50%_35%,rgba(255,75,51,0.45)_0%,rgba(255,75,51,0.12)_42%,transparent_72%)] blur-[68px]"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -top-20 left-[18%] h-[280px] w-[min(55%,340px)] bg-[radial-gradient(ellipse_at_center,rgba(255,120,90,0.22)_0%,transparent_68%)] blur-[56px]"
            aria-hidden
          />

          <div className="absolute left-8 top-8 z-10">
            <p className="font-heading text-xl font-semibold tracking-[-0.03em] text-white">
              Arciin
            </p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">
              Sign in
            </p>
          </div>

          <div className="absolute bottom-10 left-8 right-8 z-10">
            <LoginHeroCopy />
          </div>
        </div>
      </section>

      <section className="relative z-0 flex min-h-svh w-full flex-col overflow-hidden lg:w-[52%] xl:w-[55%]">
        <header className="relative z-10 shrink-0 px-6 sm:px-10 lg:px-16">
          <div className="flex h-16 items-center justify-between">
            <div className="lg:hidden">
              <p className="font-heading text-sm font-semibold tracking-tight text-white">
                Arciin
              </p>
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                Sign in
              </p>
            </div>
            <div className="hidden text-xs text-zinc-500 lg:block">
              Local instance access
            </div>
          </div>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-6 sm:px-10 sm:py-8 lg:px-16 lg:py-10">
          <div className="w-full max-w-xl">
            <div className="mb-8 space-y-2 lg:mb-10">
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Sign in
              </h1>
              <p className="text-sm leading-relaxed text-zinc-400">
                Use the email and password for this Arciin instance. Need to claim the server
                first?{" "}
                <Link href="/setup" className="text-zinc-200 underline-offset-4 hover:underline">
                  Start setup
                </Link>
                .
              </p>
            </div>
            <LoginForm />
          </div>
        </div>

        <footer className="relative z-10 flex shrink-0 justify-end gap-6 border-t border-white/[0.06] px-6 py-4 sm:px-10 lg:px-16">
          <Link
            href="/legal/privacy"
            className="text-[11px] text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-300 hover:underline"
          >
            Privacy
          </Link>
          <Link
            href="/legal/terms"
            className="text-[11px] text-zinc-500 underline-offset-4 transition-colors hover:text-zinc-300 hover:underline"
          >
            Terms
          </Link>
        </footer>
      </section>
    </main>
  )
}
