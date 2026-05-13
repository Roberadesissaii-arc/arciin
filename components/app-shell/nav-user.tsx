"use client"

import { useRouter } from "next/navigation"
import {
  Code2,
  ChevronsUpDown,
  HelpCircle,
  LogOut,
  UserCog,
} from "lucide-react"
import { toast } from "sonner"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useLogout } from "@/hooks/use-auth"
import type { AuthSession } from "@/lib/types/models"

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
}

export function NavUser({ auth }: { auth: AuthSession }) {
  const router = useRouter()
  const { isMobile } = useSidebar()
  const logoutMutation = useLogout()

  async function handleLogout() {
    try {
      await logoutMutation.mutateAsync()
      toast.success("Signed out.")
      router.push("/login")
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not sign out.")
    }
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="h-auto rounded-xl border border-sidebar-border/60 bg-white/[0.03] px-3 py-2 data-[state=open]:border-sidebar-border data-[state=open]:bg-white/[0.06] group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            >
              <div className="relative shrink-0">
                <Avatar className="h-7 w-7 rounded-xl">
                  <AvatarFallback className="rounded-xl bg-zinc-800 text-[12px] font-bold text-white">
                    {initials(auth.user.name)}
                  </AvatarFallback>
                </Avatar>
                <span
                  className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border-[1.5px] border-sidebar"
                  style={{ background: "#4ade80" }}
                  aria-hidden
                />
              </div>
              <div className="grid min-w-0 flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate text-[12px] font-semibold text-white">{auth.user.name}</span>
                <span className="truncate text-[10px] text-white/30">{auth.user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-3 shrink-0 text-white/25 group-data-[collapsible=icon]:hidden" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            side={isMobile ? "bottom" : "top"}
            align="start"
            sideOffset={8}
            className="w-56 rounded-xl border border-white/[0.07] bg-[#111118] p-1 shadow-2xl"
          >
            {/* Header */}
            <DropdownMenuLabel className="px-2 pb-2 pt-1.5">
              <p className="text-[13px] font-semibold text-white">{auth.user.name}</p>
              <p className="mt-0.5 text-[11px] font-normal text-white/35">{auth.user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/[0.07]" />

            {/* Account actions — mirrors Arceclaw: Support / Developer / Edit Profile */}
            <DropdownMenuGroup>
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-[13px] text-white/50 focus:text-white"
                onClick={() => router.push("/settings")}
              >
                <HelpCircle className="size-3.5" />
                Support
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-[13px] text-white/50 focus:text-white"
                onClick={() => router.push("/api-keys")}
              >
                <Code2 className="size-3.5" />
                Developer
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-[13px] text-white/50 focus:text-white"
                onClick={() => router.push("/settings/users")}
              >
                <UserCog className="size-3.5" />
                Edit Profile
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="bg-white/[0.07]" />

            {/* Sign out */}
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-[13px] text-red-400 focus:text-red-300"
              disabled={logoutMutation.isPending}
              onClick={handleLogout}
            >
              <LogOut className="size-3.5" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
