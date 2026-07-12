"use client"

import { MonitorSmartphone, Smartphone } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function MobileWebUnavailable({ className }: { className?: string }) {
  const onMobileAppClick = (event: React.MouseEvent) => {
    event.preventDefault()
    toast.info("Arciin mobile app", {
      description: "iOS and Android apps are in development. Use the desktop web app on a larger screen for now.",
    })
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-[200] flex min-h-[100dvh] flex-col overflow-y-auto bg-white text-zinc-900",
        className,
      )}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="relative flex flex-1 flex-col px-6 py-8 sm:px-10">
        <header className="flex items-center justify-between">
          <p className="font-heading text-lg font-semibold tracking-tight text-zinc-900">
            Arciin
            <span className="text-primary">.</span>
          </p>
          <Badge
            variant="outline"
            className="border-zinc-200 bg-zinc-50 text-[10px] font-semibold uppercase tracking-wider text-zinc-600"
          >
            Web · desktop
          </Badge>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center py-10">
          <div className="w-full max-w-sm space-y-10 text-center">
            <div className="space-y-5">
              <div className="relative mx-auto w-fit text-zinc-400">
                <MonitorSmartphone className="size-9 stroke-[1.5]" aria-hidden />
                <Smartphone
                  className="absolute -right-0.5 -bottom-0.5 size-3.5 text-zinc-500"
                  aria-hidden
                />
              </div>

              <div className="space-y-2.5">
                <h1 className="font-heading text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
                  Built for desktop, not phones
                </h1>
                <p className="text-[14px] leading-relaxed text-zinc-500">
                  Libraries, uploads, and settings need a larger screen. Open this URL on a computer
                  or tablet in landscape.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
                Native apps in progress
              </p>
              <a
                href="#arciin-mobile-app"
                onClick={onMobileAppClick}
                className={cn(
                  "group relative inline-flex w-full flex-col items-center gap-1.5 rounded-2xl border border-zinc-200 bg-zinc-50/50 px-5 py-4",
                  "transition-colors hover:border-zinc-300 hover:bg-zinc-50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300",
                )}
                aria-describedby="mobile-app-soon"
              >
                <span className="font-medium text-zinc-900">Arciin mobile app</span>
                <span className="text-[13px] text-zinc-500">
                  iOS &amp; Android · same instance, built for touch
                </span>
                <Badge className="absolute -top-2.5 right-4 border-0 bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Coming soon
                </Badge>
              </a>
              <p id="mobile-app-soon" className="text-[12px] leading-relaxed text-zinc-400">
                Store links aren&apos;t live yet. Your server and data stay where you control them.
              </p>
            </div>
          </div>
        </div>

        <footer className="shrink-0 border-t border-zinc-100 pt-5 text-center text-[12px] text-zinc-400">
          <p>Your server, your control.</p>
        </footer>
      </div>
    </div>
  )
}
