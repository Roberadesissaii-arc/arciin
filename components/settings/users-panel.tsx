"use client"

import { PageHeader } from "@/components/app-shell/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <span className="text-zinc-600">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  )
}

export function UsersPanel({
  variant = "embedded",
}: {
  variant?: "embedded" | "page"
}) {
  const authQuery = useAuth()

  return (
    <div className="space-y-6">
      {variant === "page" ? (
        <PageHeader
          title="Users"
          description="Owner account details and future member management."
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">Owner</CardTitle>
            <CardDescription className="text-zinc-600">
              The first user created during setup is the instance owner.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {authQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 rounded-xl" />
                <Skeleton className="h-8 rounded-xl" />
              </div>
            ) : authQuery.data ? (
              <div className="divide-y divide-border">
                <InfoRow label="Name" value={authQuery.data.user.name} />
                <InfoRow label="Email" value={authQuery.data.user.email} />
                <InfoRow label="Role" value={authQuery.data.user.role} />
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No user data available.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">Member management</CardTitle>
            <CardDescription className="text-zinc-600">
              Arciin does not support public signup. Multi-user management is coming.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-600">
            <p>Planned roles: OWNER, ADMIN, MEMBER, VIEWER.</p>
            <p>Invite flows and auditing will be added once the core app is stable.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

