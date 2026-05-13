import { AppSidebar } from "@/components/app-shell/app-sidebar"
import { DashboardMobileSidebarButton } from "@/components/app-shell/dashboard-mobile-sidebar-button"
import { DashboardHeader } from "@/components/app-shell/dashboard-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { AuthSession } from "@/lib/types/models"

export function DashboardShell({
  children,
  auth,
}: {
  children: React.ReactNode
  auth: AuthSession
}) {
  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-transparent">
      <TooltipProvider delayDuration={0}>
        <SidebarProvider
          defaultOpen
          className="relative z-10 flex min-h-0 flex-1 flex-row overflow-hidden bg-transparent"
        >
          <AppSidebar auth={auth} />
          <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DashboardMobileSidebarButton />
            <DashboardHeader />
            <div className="scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-4 lg:px-5">
              <div className="flex w-full min-w-0 flex-1 flex-col gap-6">{children}</div>
            </div>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </div>
  )
}
