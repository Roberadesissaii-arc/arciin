import { AuthRouteGuard } from "@/components/auth/auth-route-guard"
import { LoginPageShell } from "@/components/auth/login-page-shell"

export const dynamic = "force-dynamic"

export default function LoginPage() {
  return (
    <AuthRouteGuard
      contextLabel="Sign in"
      unavailableTitle="Sign-in is waiting for the instance service."
      unavailableDescription="Arciin needs the API online before it can verify sessions or authenticate the owner account."
      redirects={{ setupRequired: "/setup", authenticated: "/dashboard" }}
    >
      <LoginPageShell />
    </AuthRouteGuard>
  )
}
