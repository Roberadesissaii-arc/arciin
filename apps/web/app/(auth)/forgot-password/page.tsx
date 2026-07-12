import { AuthRouteGuard } from "@/components/auth/auth-route-guard"
import { ForgotPasswordPageShell } from "@/components/auth/forgot-password-page-shell"

export const dynamic = "force-dynamic"

export default function ForgotPasswordPage() {
  return (
    <AuthRouteGuard
      contextLabel="Forgot password"
      unavailableTitle="Password recovery is waiting for the instance service."
      unavailableDescription="Arciin needs the API online before it can look up your security question."
      redirects={{ setupRequired: "/setup", authenticated: "/dashboard" }}
    >
      <ForgotPasswordPageShell />
    </AuthRouteGuard>
  )
}
