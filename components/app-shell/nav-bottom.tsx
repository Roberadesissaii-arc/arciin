"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { sidebarNavBottom } from "@/components/app-shell/navigation"
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

function pathActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function NavBottom() {
  const pathname = usePathname()

  return (
    <SidebarGroup className="gap-0 px-2 py-0">
      <SidebarMenu className="gap-[1px]">
        {sidebarNavBottom.map((item) => {
          const Icon   = item.icon
          const active = pathActive(pathname, item.href)
          return (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={active}
                tooltip={item.title}
                className="h-7 gap-2.5 px-3 text-[13px] [&_svg]:size-[15px] [&_svg]:shrink-0"
              >
                <Link href={item.href}>
                  <Icon />
                  <span className="leading-none">{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
