import { redirect } from "next/navigation"
import type { ReactNode } from "react"

import { AccessDeniedScreen } from "@/components/app-shell/access-denied-screen"
import { SystemUnavailable } from "@/components/app-shell/system-unavailable"
import { getRootRouteState } from "@/lib/utils/route-guards"

type RouteRedirects = {
  setupRequired?: string
  authenticated?: string
  unauthenticated?: string
}

/** Shared setup/auth state gate for login, forgot-password, and setup pages. */
export async function AuthRouteGuard({
  contextLabel,
  unavailableTitle,
  unavailableDescription,
  redirects,
  children,
}: {
  contextLabel: string
  unavailableTitle: string
  unavailableDescription: string
  redirects: RouteRedirects
  children: ReactNode
}) {
  const state = await getRootRouteState()

  if (state.kind === "setup-required" && redirects.setupRequired) {
    redirect(redirects.setupRequired)
  }

  if (state.kind === "authenticated" && redirects.authenticated) {
    redirect(redirects.authenticated)
  }

  if (state.kind === "unauthenticated" && redirects.unauthenticated) {
    redirect(redirects.unauthenticated)
  }

  if (state.kind === "unavailable") {
    return (
      <SystemUnavailable
        contextLabel={contextLabel}
        title={unavailableTitle}
        description={unavailableDescription}
      />
    )
  }

  if (state.kind === "ip-forbidden") {
    return (
      <AccessDeniedScreen
        theme="light"
        contextLabel={contextLabel}
        message={state.message}
        instanceName={state.instance.instanceName}
      />
    )
  }

  return children
}
