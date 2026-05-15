"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Activity, Files, LayoutDashboard, MessageSquare, Settings } from "lucide-react"

import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { href: "/dashboard", label: "Home",     icon: LayoutDashboard },
  { href: "/files",     label: "Files",    icon: Files           },
  { href: "/chat",      label: "Chat",     icon: MessageSquare   },
  { href: "/activity",  label: "Activity", icon: Activity        },
  { href: "/settings",  label: "Settings", icon: Settings        },
] as const

export function MobileBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="relative z-20 shrink-0 border-t border-white/[0.06] bg-[#09090b]/95 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex h-16 items-stretch">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium tracking-wide transition-colors",
                active ? "text-[#ff4f12]" : "text-zinc-500 active:text-zinc-300",
              )}
            >
              <Icon
                className={cn(
                  "size-[22px] transition-transform active:scale-90",
                  active && "drop-shadow-[0_0_8px_rgba(255,79,18,0.6)]",
                )}
              />
              <span>{label}</span>
              {active && (
                <span className="absolute bottom-0 h-0.5 w-6 rounded-full bg-[#ff4f12] opacity-80" />
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
