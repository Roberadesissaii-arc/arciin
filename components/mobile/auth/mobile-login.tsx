"use client"

import Link from "next/link"

import { LoginForm } from "@/components/auth/login-form"

export function MobileLogin() {
  return (
    <div
      className="relative flex min-h-[100dvh] flex-col bg-[#09090b]"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Atmosphere — identical to desktop login */}
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden
        style={{
          background: [
            "radial-gradient(ellipse 90% 75% at 100% 0%, rgba(255,75,51,0.22), transparent 55%)",
            "radial-gradient(ellipse 60% 50% at 96% 6%, rgba(255,120,90,0.1), transparent 48%)",
          ].join(","),
        }}
      />
      <div
        className="pointer-events-none fixed inset-0"
        aria-hidden
        style={{ background: "linear-gradient(145deg, rgba(255,75,51,0.07) 0%, transparent 42%)" }}
      />

      {/* Brand wordmark */}
      <header className="relative z-10 shrink-0 px-7">
        <div className="flex h-16 items-center">
          <div>
            <p className="font-heading text-[15px] font-semibold tracking-tight text-white">
              Arciin
            </p>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
              Sign in
            </p>
          </div>
        </div>
      </header>

      {/* Form content */}
      <div className="relative z-10 flex flex-1 flex-col justify-center px-7 py-6">
        <div className="mb-8 space-y-2">
          <h1 className="font-heading text-[28px] font-semibold tracking-tight text-white leading-none">
            Sign in
          </h1>
          <p className="text-[14px] leading-relaxed text-zinc-400">
            Use the email and password for this Arciin instance. Need to claim the server first?{" "}
            <Link href="/setup" className="text-zinc-200 underline-offset-4 hover:underline">
              Start setup
            </Link>
            .
          </p>
        </div>

        <LoginForm />
      </div>

      {/* Footer */}
      <footer className="relative z-10 shrink-0 flex justify-end gap-6 border-t border-white/[0.06] px-7 py-4">
        <Link
          href="/legal/privacy"
          className="text-[11px] text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline transition-colors"
        >
          Privacy
        </Link>
        <Link
          href="/legal/terms"
          className="text-[11px] text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline transition-colors"
        >
          Terms
        </Link>
      </footer>
    </div>
  )
}
