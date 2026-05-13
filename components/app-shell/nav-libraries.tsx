"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Minus, Sparkles } from "lucide-react"

import { useLibraries } from "@/hooks/use-libraries"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const LIBRARY_SLUG_TO_ROUTE: Record<string, string> = {
  videos:    "/videos",
  images:    "/images",
  music:     "/music",
  documents: "/documents",
}

// Arceclaw color tokens
const SECT   = "rgba(255,255,255,0.3)"
const CNT_BG = "rgba(255,255,255,0.07)"
const CNT_TX = "rgba(255,255,255,0.45)"
const CNT_ABG = "rgba(255,75,18,0.16)"
const CNT_ATX = "#ff8f66"

function pathActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function NavLibraries() {
  const pathname = usePathname()
  const { data: libraries } = useLibraries()

  const items = (libraries ?? [])
    .filter((lib) => LIBRARY_SLUG_TO_ROUTE[lib.slug] !== undefined)
    .map((lib) => ({
      id:    lib.id,
      title: lib.name,
      href:  LIBRARY_SLUG_TO_ROUTE[lib.slug]!,
      count: lib.assetCount,
    }))

  return (
    <SidebarGroup className="gap-0 px-2 py-0">
      {/*
        Section header — static (no dropdown), matches Arceclaw's SectionBlock header:
        gap-2.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider + Minus right
      */}
      <div
        className="flex w-full items-center gap-2.5 px-3 py-2 group-data-[collapsible=icon]:hidden"
        style={{ color: SECT }}
      >
        <Sparkles className="size-[15px] shrink-0" aria-hidden />
        <span className="flex-1 text-left text-[11px] font-semibold uppercase leading-none tracking-wider">
          Libraries
        </span>
        <Minus className="size-3 shrink-0 opacity-40" aria-hidden />
      </div>

      {/*
        Sub-items — always expanded, hidden in icon-collapsed mode.
        mt-0.5 pb-1 matches Arceclaw's sub-item container: mt-0.5 pb-1
        Sub-item links: pl-9 pr-3 py-[7px] text-[13px] — exact Arceclaw values
      */}
      <div className="mt-0.5 pb-1 group-data-[collapsible=icon]:hidden">
        <SidebarMenu className="gap-[1px]">
          {items.map((item) => {
            const active = pathActive(pathname, item.href)
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  className="h-7 gap-0 pl-9 pr-3 text-[13px] [&_svg]:hidden"
                >
                  <Link href={item.href} className="flex w-full items-center">
                    <span className="flex-1 truncate leading-none">{item.title}</span>
                    {item.count > 0 && (
                      <span
                        className="ml-2 shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-none"
                        style={{
                          background: active ? CNT_ABG : CNT_BG,
                          color:      active ? CNT_ATX : CNT_TX,
                        }}
                      >
                        {item.count}
                      </span>
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </div>
    </SidebarGroup>
  )
}
