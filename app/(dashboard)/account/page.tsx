import { PageHeader } from "@/components/app-shell/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function AccountPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Account"
        description="Manage your personal profile, email address, and password."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Profile</CardTitle>
            <CardDescription className="text-zinc-400">
              Update your display name and email address.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-zinc-500">Coming soon</CardContent>
        </Card>
        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Password</CardTitle>
            <CardDescription className="text-zinc-400">
              Change your login password.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-zinc-500">Coming soon</CardContent>
        </Card>
        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Sessions</CardTitle>
            <CardDescription className="text-zinc-400">
              View and revoke active login sessions for your account.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-zinc-500">Coming soon</CardContent>
        </Card>
      </div>
    </div>
  )
}
