"use client"

import { Smartphone } from "lucide-react"

import { MobileAppInstallPanel } from "@/components/settings/mobile-app-install-panel"

/** Arciin Mobile PWA — install beside the server repo. */
export function MobileAppIntegrationCard() {
  return (
    <section aria-labelledby="integrations-mobile-app" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="integrations-mobile-app" className="text-sm font-semibold tracking-tight text-foreground">
            Client apps
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Optional phone PWA — same API, no extra database on the device
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          <Smartphone className="size-3.5" />
          arciin-app
        </span>
      </div>
      <MobileAppInstallPanel />
    </section>
  )
}
