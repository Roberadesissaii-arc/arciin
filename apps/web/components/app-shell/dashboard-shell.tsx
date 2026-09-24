import { LoginWelcomeToast } from "@/components/auth/login-welcome-toast"
import { WindowsDesktopPromo } from "@/components/app-shell/windows-desktop-promo"
import { AppSidebar } from "@/components/app-shell/app-sidebar"
import { IdleLogoutWatcher } from "@/components/app-shell/idle-logout-watcher"
import { MobileWebUnavailable } from "@/components/app-shell/mobile-web-unavailable"
import { DashboardContentArea } from "@/components/app-shell/dashboard-content-area"
import { DashboardMobileSidebarButton } from "@/components/app-shell/dashboard-mobile-sidebar-button"
import { DashboardHeader } from "@/components/app-shell/dashboard-header"
import { MusicPlayerBar } from "@/components/libraries/music-player-bar"
import { UploadOverlay } from "@/components/uploads/upload-overlay"
import { PersistedSidebarProvider } from "@/components/app-shell/persisted-sidebar-provider"
import { SidebarInset } from "@/components/ui/sidebar"
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
      <div className="dashboard-shell-canvas relative hidden h-[100dvh] max-h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-white md:flex">
      <IdleLogoutWatcher />
      <LoginWelcomeToast />
      <WindowsDesktopPromo />
      <TooltipProvider delayDuration={0}>
        <PersistedSidebarProvider
          className="relative z-10 flex min-h-0 flex-1 flex-row overflow-hidden bg-white"
        >
          <AppSidebar auth={auth} />
          <SidebarInset className="dashboard-main relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
            <DashboardMobileSidebarButton />
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                id="arciin-dashboard-workspace-host"
                className="pointer-events-none absolute inset-0 z-[60]"
                aria-hidden
              />
              <div className="scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
                <DashboardHeader />
                <DashboardContentArea>{children}</DashboardContentArea>
              </div>
            </div>
            <UploadOverlay />
            <MusicPlayerBar />
          </SidebarInset>
        </PersistedSidebarProvider>
      </TooltipProvider>
      </div>
    </>
  )
}
