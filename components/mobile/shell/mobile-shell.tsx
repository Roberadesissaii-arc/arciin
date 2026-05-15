"use client"

import { MobileBottomNav } from "@/components/mobile/shell/mobile-bottom-nav"
import { MobileHeader } from "@/components/mobile/shell/mobile-header"

interface MobileShellProps {
  children: React.ReactNode
}

export function MobileShell({ children }: MobileShellProps) {
  return (
    <div
      className="relative flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[#09090b]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Ambient glow top-right */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 70% 40% at 100% 0%, rgba(255,75,51,0.12) 0%, transparent 60%)",
        }}
      />

      <MobileHeader />

      {/* Scrollable content */}
      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain">
        <div className="flex min-h-full flex-col gap-4 px-4 py-4 pb-2">
          {children}
        </div>
      </main>

      <MobileBottomNav />
    </div>
  )
}
