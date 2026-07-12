import Link from "next/link"
import { Ban, ShieldBan } from "lucide-react"

import { AUTH_HERO_GRADIENT } from "@/components/auth/auth-light"
import {
  InstanceAuthAtmosphere,
  InstanceAuthPanel,
} from "@/components/auth/instance-auth-chrome"
import { ArciinMarkLetter } from "@/components/ui/arciin-icon"
import { Badge } from "@/components/ui/badge"
import {
  ipForbiddenScreenCopy,
  resolveIpForbiddenReason,
} from "@/lib/security/ip-forbidden"

type AccessDeniedScreenProps = {
  message?: string
  instanceName?: string
  /** Short label under the Arciin wordmark (e.g. Sign in, Dashboard). */
  contextLabel?: string
  /** Light auth pages vs dark instance shell. */
  theme?: "light" | "dark"
}

export function AccessDeniedScreen({
  message,
  instanceName,
  contextLabel = "Access",
  theme = "dark",
}: AccessDeniedScreenProps) {
  const reason = resolveIpForbiddenReason(message)
  const copy = ipForbiddenScreenCopy(reason)
  const displayName = instanceName?.trim() || "Arciin"

  if (theme === "light") {
    return (
      <main className="flex h-svh overflow-hidden bg-white text-[#222222]">
        <div className="flex h-full w-full">
          <section className="relative flex h-full min-h-0 w-full flex-col px-7 py-6 sm:px-10 lg:w-1/2 lg:px-12">
            <div className="flex shrink-0 items-center gap-2">
              <ArciinMarkLetter size="sm" />
              <span className="font-heading text-[17px] font-bold leading-none tracking-tight text-[#111111]">
                {displayName}
                <span className="text-[#ff4f12]">.</span>
              </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
              <div className="w-full max-w-sm text-center">
                <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl border border-[#f0f0f0] bg-[#fafafa] text-[#ef4444] shadow-sm">
                  <Ban className="size-7" strokeWidth={2} aria-hidden />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a0a0a0]">
                  Access denied
                </p>
                <h1 className="mt-2 font-heading text-[26px] font-bold tracking-tight text-[#111111]">
                  {copy.title}
                </h1>
                <p className="mt-3 text-left text-[13px] leading-relaxed text-[#7a7a7a]">
                  {copy.description}
                </p>
                <p className="mt-5 rounded-xl border border-[#ececec] bg-[#fafafa] px-4 py-3 text-left text-[12px] leading-relaxed text-[#8a8a8a]">
                  If you believe this is a mistake, contact the administrator of this
                  instance. They can update the IP blocklist or allowlist in Settings →
                  Security.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-4">
              <p className="text-[11px] text-[#b3b3b3]">Copyright © 2026 Arciin.</p>
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

          <section className="hidden h-full lg:block lg:w-1/2 lg:p-4 lg:pl-0">
            <div
              className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[22px] p-10"
              style={{ background: AUTH_HERO_GRADIENT }}
            >
              <div className="max-w-sm space-y-4 text-center text-white">
                <div className="mx-auto flex size-16 items-center justify-center rounded-3xl border border-white/20 bg-white/10 backdrop-blur-sm">
                  <ShieldBan className="size-8 text-white/90" aria-hidden />
                </div>
                <p className="font-heading text-2xl font-semibold tracking-tight">
                  Network access restricted
                </p>
                <p className="text-sm leading-relaxed text-white/75">
                  {displayName} is reachable only from networks this server trusts.
                </p>
              </div>
            </div>
          </section>
        </div>
      </main>
    )
  }

  return (
    <main className="relative flex min-h-svh bg-background">
      <InstanceAuthAtmosphere />

      <section className="relative z-0 hidden lg:flex lg:w-[48%] xl:w-[45%] lg:p-5">
        <InstanceAuthPanel className="flex flex-1 flex-col">
          <div className="absolute left-8 top-8 z-10">
            <p className="font-heading text-xl font-semibold tracking-[-0.03em] text-white">
              {displayName}
            </p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-500">
              {contextLabel}
            </p>
          </div>

          <div className="absolute bottom-10 left-8 right-8 z-10 max-w-md space-y-4">
            <Badge className="border border-white/10 bg-white/[0.05] px-3 py-1 text-[#FFB39C] hover:bg-white/[0.05]">
              Your server, your control.
            </Badge>
            <div className="space-y-3">
              <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
                Access denied.
                <span className="block text-white/45">This network is not permitted.</span>
              </h1>
              <p className="text-base leading-7 text-zinc-400">
                Arciin blocked this connection based on its security policy. The app shell
                loaded, but API access from this device or network is not allowed.
              </p>
            </div>
          </div>
        </InstanceAuthPanel>
      </section>

      <section className="relative z-0 flex min-h-svh w-full flex-col overflow-hidden lg:w-[52%] xl:w-[55%]">
        <header className="relative z-10 shrink-0 px-6 sm:px-10 lg:px-16">
          <div className="flex h-16 items-center justify-between">
            <div className="lg:hidden">
              <p className="font-heading text-sm font-semibold tracking-tight text-white">
                {displayName}
              </p>
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                {contextLabel}
              </p>
            </div>
            <div className="hidden text-xs text-zinc-500 lg:block">Security policy</div>
          </div>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-6 sm:px-10 sm:py-8 lg:px-16 lg:py-10">
          <div className="w-full max-w-xl space-y-8">
            <div className="space-y-2">
              <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-[#ef4444]/25 bg-[#ef4444]/10 text-[#f87171]">
                <Ban className="size-6" aria-hidden />
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                403 · Forbidden
              </p>
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {copy.title}
              </h1>
              <p className="text-sm leading-relaxed text-zinc-400">{copy.description}</p>
            </div>

            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm leading-relaxed text-zinc-300">
              <p>
                An administrator can allow this network from{" "}
                <span className="text-zinc-200">Settings → Security</span> by updating the IP
                blocklist or allowlist. Until then, sign-in, uploads, and the dashboard will
                not load from this connection.
              </p>
            </div>
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
