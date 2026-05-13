"use client"

import { formatRelativeDate } from "@/lib/utils/format-date"
import { PageHeader } from "@/components/app-shell/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono text-white">{value}</span>
    </div>
  )
}

export default function SecurityPage() {
  const authQuery = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security"
        description="Core protections for sessions, setup lock, and local operator access."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Active Session</CardTitle>
            <CardDescription className="text-zinc-400">
              Your current authenticated session and identity.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {authQuery.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 rounded-xl" />
                <Skeleton className="h-8 rounded-xl" />
                <Skeleton className="h-8 rounded-xl" />
              </div>
            ) : authQuery.data ? (
              <div className="divide-y divide-white/[0.06]">
                <InfoRow label="Operator" value={authQuery.data.user.name} />
                <InfoRow label="Email" value={authQuery.data.user.email} />
                <InfoRow label="Role" value={authQuery.data.user.role} />
                <InfoRow
                  label="Session started"
                  value={formatRelativeDate(authQuery.data.session.createdAt)}
                />
                <InfoRow
                  label="Session expires"
                  value={formatRelativeDate(authQuery.data.session.expiresAt)}
                />
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No session data available.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Authentication Model</CardTitle>
            <CardDescription className="text-zinc-400">
              How credentials and sessions are secured on this instance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-white/[0.06]">
              <InfoRow label="Password hashing" value="Argon2id" />
              <InfoRow label="Session storage" value="Hashed tokens" />
              <InfoRow label="Cookie flags" value="httpOnly · SameSite=Lax" />
              <InfoRow label="Public signup" value="Disabled" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Setup Lock</CardTitle>
            <CardDescription className="text-zinc-400">
              The first successful claim permanently disables the setup route.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-400">
            <p>The owner account is created only during the initial claim flow.</p>
            <p>There is no path to re-open setup without direct database access.</p>
            <p>Destructive actions stay gated behind role checks and confirmations.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
