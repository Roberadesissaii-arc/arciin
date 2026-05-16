import Link from "next/link"
import { AlertTriangle, LaptopMinimalCheck } from "lucide-react"

import {
  InstanceAuthAtmosphere,
  InstanceAuthPanel,
} from "@/components/auth/instance-auth-chrome"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const apiHealthUrl = `${(process.env.NEXT_PUBLIC_ARCIIN_API_ORIGIN || "http://localhost:4000").replace(/\/$/, "")}/api/health`

export function SystemUnavailable({
  title = "Arciin could not initialize its instance service.",
  description = "The web shell is up, but the API, Redis, or database configuration is not ready right now.",
  contextLabel = "Status",
}: {
  title?: string
  description?: string
  /** Short label under the Arciin wordmark (e.g. Sign in, Setup, Status). */
  contextLabel?: string
}) {
  return (
    <main className="relative flex min-h-svh bg-background">
      <InstanceAuthAtmosphere />

      <section className="relative z-0 hidden lg:flex lg:w-[48%] xl:w-[45%] lg:p-5">
        <InstanceAuthPanel className="flex flex-1 flex-col">
          <div className="absolute left-8 top-8 z-10">
            <p className="font-heading text-xl font-semibold tracking-[-0.03em] text-white">
              Arciin
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
                Waiting for the API.
                <span className="block text-white/45">The shell is ready.</span>
              </h1>
              <p className="text-base leading-7 text-zinc-400">
                Arciin&apos;s interface loaded in the browser, but the instance service has not
                responded yet. Once the API, database, and Redis are reachable, this screen goes
                away automatically.
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
                Arciin
              </p>
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
                {contextLabel}
              </p>
            </div>
            <div className="hidden text-xs text-zinc-500 lg:block">Instance service</div>
          </div>
        </header>

        <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-6 sm:px-10 sm:py-8 lg:px-16 lg:py-10">
          <div className="w-full max-w-xl space-y-8">
            <div className="space-y-2">
              <div className="mb-4 flex size-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-[#FF8F66]">
                <LaptopMinimalCheck className="size-6" aria-hidden />
              </div>
              <h1 className="font-heading text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                {title}
              </h1>
              <p className="text-sm leading-relaxed text-zinc-400">{description}</p>
            </div>

            <div className="flex items-start gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm leading-relaxed text-zinc-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#F59E0B]" aria-hidden />
              <p>
                Make sure the Fastify API is running and that{" "}
                <span className="font-mono text-zinc-200">ARCIIN_API_URL</span> points at it. If
                the API is up but this page remains, verify Redis and the database credentials too.
              </p>
            </div>

            <Button asChild size="lg" className="h-11 w-full">
              <a href={apiHealthUrl} target="_blank" rel="noreferrer">
                Probe API health
              </a>
            </Button>
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
