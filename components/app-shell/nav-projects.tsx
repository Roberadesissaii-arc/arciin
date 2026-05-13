"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { MoreHorizontal } from "lucide-react"

import type { SidebarProjectItem } from "@/components/app-shell/navigation"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

function pathActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === href
  }

  return pathname === href || pathname.startsWith(`${href}/`)
}

export function NavProjects({ projects }: { projects: SidebarProjectItem[] }) {
  const pathname = usePathname()

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Projects</SidebarGroupLabel>
      <SidebarMenu>
        {projects.map((item) => {
          const Icon = item.icon
          const active = pathActive(pathname, item.href)

          return (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton asChild isActive={active} tooltip={item.name}>
                <Link href={item.href}>
                  <Icon />
                  <span>{item.name}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
        <SidebarMenuItem>
          <SidebarMenuButton asChild className="text-sidebar-foreground/70">
            <Link href="/files">
              <MoreHorizontal className="text-sidebar-foreground/70" />
              <span>More</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  )
}
