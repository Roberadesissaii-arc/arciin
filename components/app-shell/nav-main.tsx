"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"

import type { SidebarNavEntry } from "@/components/app-shell/navigation"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

function pathActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

function groupDefaultOpen(item: SidebarNavEntry, pathname: string) {
  if (!item.items?.length) return false
  if (pathActive(pathname, item.href)) return true
  return item.items.some((sub) => pathActive(pathname, sub.href))
}

// Exact Arceclaw item style: gap-2.5 px-3, icons 15×15, font 13px, height 28px
const BTN = "h-7 gap-2.5 px-3 text-[13px] [&_svg]:size-[15px] [&_svg]:shrink-0"

export function NavMain({
  label,
  items,
  expandFirstCollapsible = false,
}: {
  label?: string
  items: SidebarNavEntry[]
  expandFirstCollapsible?: boolean
}) {
  const pathname = usePathname()
  const firstCollapsibleIndex = items.findIndex((entry) => entry.items?.length)

  return (
    /* py-0: overall vertical rhythm comes from SidebarContent py-2.5 */
    <SidebarGroup className="gap-0 px-2 py-0">
      {label ? (
        <p className="mb-0.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
          {label}
        </p>
      ) : null}
      {/* gap-[1px] matches Arceclaw's space-y-[1px] between items */}
      <SidebarMenu className="gap-[1px]">
        {items.map((item, index) => {
          const Icon = item.icon

          if (!item.items?.length) {
            const active = pathActive(pathname, item.href)
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.title} className={BTN}>
                  <Link href={item.href}>
                    <Icon />
                    <span className="leading-none">{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          }

          const isFirstCollapsible = Boolean(item.items?.length) && index === firstCollapsibleIndex
          const open = (expandFirstCollapsible && isFirstCollapsible) || groupDefaultOpen(item, pathname)

          return (
            <SidebarMenuItem key={item.title}>
              <Collapsible defaultOpen={open} className="group/collapsible">
                <CollapsibleTrigger asChild>
                  <SidebarMenuButton tooltip={item.title} className={BTN}>
                    <Icon />
                    <span className="leading-none">{item.title}</span>
                    <ChevronRight className="ml-auto size-3 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                  </SidebarMenuButton>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((sub) => (
                      <SidebarMenuSubItem key={sub.href}>
                        <SidebarMenuSubButton asChild isActive={pathActive(pathname, sub.href)}>
                          <Link href={sub.href}>
                            <span>{sub.title}</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
