import { AppSidebar } from "@/components/app-shell/app-sidebar"
import { IdleLogoutWatcher } from "@/components/app-shell/idle-logout-watcher"
import { MobileWebUnavailable } from "@/components/app-shell/mobile-web-unavailable"
import { DashboardContentArea } from "@/components/app-shell/dashboard-content-area"
import { DashboardMobileSidebarButton } from "@/components/app-shell/dashboard-mobile-sidebar-button"
import { DashboardHeader } from "@/components/app-shell/dashboard-header"
import { UploadOverlay } from "@/components/uploads/upload-overlay"
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
    <>
      <MobileWebUnavailable className="md:hidden" />
      <div className="relative hidden h-[100dvh] max-h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-transparent md:flex">
      <IdleLogoutWatcher />
      <TooltipProvider delayDuration={0}>
        <SidebarProvider
          defaultOpen
          className="relative z-10 flex min-h-0 flex-1 flex-row overflow-hidden bg-transparent"
        >
          <AppSidebar auth={auth} />
          <SidebarInset className="relative dashboard-main flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground md:peer-data-[variant=inset]:!border-border md:peer-data-[variant=inset]:!bg-background md:peer-data-[variant=inset]:!text-foreground md:peer-data-[variant=inset]:!shadow-sm md:peer-data-[variant=inset]:!ring-zinc-200/40 md:peer-data-[variant=inset]:!backdrop-blur-none">
            <DashboardMobileSidebarButton />
            <DashboardHeader />
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-50/80">
              <div
                id="arciin-dashboard-workspace-host"
                className="pointer-events-none absolute inset-0 z-[60]"
                aria-hidden
              />
              <DashboardContentArea>{children}</DashboardContentArea>
            </div>
            <UploadOverlay />
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
      </div>
    </>
  )
}
