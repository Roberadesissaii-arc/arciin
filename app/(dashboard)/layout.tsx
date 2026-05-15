import { redirect } from "next/navigation"

import { DashboardShell } from "@/components/app-shell/dashboard-shell"
import { MobileShell } from "@/components/mobile/shell/mobile-shell"
import { SystemUnavailable } from "@/components/app-shell/system-unavailable"
import { SocketProvider } from "@/components/providers/socket-provider"
import { UserPreferencesProvider } from "@/components/providers/user-preferences-provider"
import { GlobalDropzoneProvider } from "@/components/uploads/global-dropzone-provider"
import { getRootRouteState } from "@/lib/utils/route-guards"

export const dynamic = "force-dynamic"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const state = await getRootRouteState()

  if (state.kind === "setup-required") {
    redirect("/setup")
  }

  if (state.kind === "unauthenticated") {
    redirect("/login")
  }

  if (state.kind === "unavailable") {
    return (
      <SystemUnavailable
        title="The dashboard shell is waiting for Arciin."
        description="The UI is ready, but the API must be online before the authenticated app can load."
      />
    )
  }

  return (
    <UserPreferencesProvider>
      <SocketProvider userId={state.auth.user.id}>
        {/* Mobile shell — only rendered on small screens */}
        <div className="md:hidden">
          <MobileShell>{children}</MobileShell>
        </div>

        {/* Desktop shell — only rendered on medium+ screens */}
        <div className="hidden md:block">
          <DashboardShell auth={state.auth}>
            <GlobalDropzoneProvider>{children}</GlobalDropzoneProvider>
          </DashboardShell>
        </div>
      </SocketProvider>
    </UserPreferencesProvider>
  )
}
