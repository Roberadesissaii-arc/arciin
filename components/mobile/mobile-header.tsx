"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { ArrowLeft, Bell, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { getPageTitle } from "@/components/app-shell/navigation"

interface MobileHeaderProps {
  title?: string
  showBack?: boolean
  actions?: React.ReactNode
  className?: string
  transparent?: boolean
}

export function MobileHeader({
  title,
  showBack,
  actions,
  className,
  transparent = false,
}: MobileHeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const pageTitle = title ?? getPageTitle(pathname)
  const isRoot = ["/dashboard", "/files", "/activity", "/settings"].includes(pathname)

  return (
    <header
      className={cn(
        "relative z-20 flex h-14 shrink-0 items-center gap-3 px-4",
        !transparent && "border-b border-white/[0.06] bg-[#09090b]/90 backdrop-blur-xl",
        className,
      )}
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      {/* Back button or logo */}
      {showBack || !isRoot ? (
        <button
          type="button"
          onClick={() => router.back()}
          className="flex size-9 items-center justify-center rounded-xl text-zinc-400 transition-colors active:bg-white/[0.06] active:text-white"
          aria-label="Go back"
        >
          <ArrowLeft className="size-5" />
        </button>
      ) : (
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="font-heading text-[15px] font-semibold tracking-tight text-white">
            Arciin
          </span>
        </Link>
      )}

      {/* Page title */}
      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-white">
        {showBack || !isRoot ? pageTitle : ""}
      </span>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        {actions ?? (
          <>
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-xl text-zinc-400 transition-colors active:bg-white/[0.06] active:text-white"
              aria-label="Search"
            >
              <Search className="size-[18px]" />
            </button>
            <button
              type="button"
              className="relative flex size-9 items-center justify-center rounded-xl text-zinc-400 transition-colors active:bg-white/[0.06] active:text-white"
              aria-label="Notifications"
            >
              <Bell className="size-[18px]" />
            </button>
          </>
        )}
      </div>
    </header>
  )
}
