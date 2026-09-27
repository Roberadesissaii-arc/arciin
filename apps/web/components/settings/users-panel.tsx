"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/notifications/arciin-toast"

import { PageHeader } from "@/components/app-shell/page-header"
import { ConfirmDestructiveButton } from "@/components/shared/confirm-destructive-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import {
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  updateAdminUser,
  type AdminUser,
} from "@/lib/api/users"
import { queryKeys } from "@/lib/api/query-keys"
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
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [role, setRole] = useState<"MEMBER" | "VIEWER" | "ADMIN">("MEMBER")

  const usersQuery = useQuery({
    queryKey: queryKeys.adminUsers,
    queryFn: ({ signal }) => listAdminUsers(signal),
  })

  const createMutation = useMutation({
    mutationFn: createAdminUser,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers })
      setName("")
      setEmail("")
      setPassword("")
      toast.success("User created")
    },
    onError: (err) => {
      toast.error("Could not create user", {
        description: err instanceof Error ? err.message : "Try again.",
      })
    },
  })

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateAdminUser>[1] }) =>
      updateAdminUser(id, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers })
    },
    onError: (err) => {
      toast.error("Update failed", {
        description: err instanceof Error ? err.message : "Try again.",
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAdminUser,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers })
      toast.success("User removed")
    },
    onError: (err) => {
      toast.error("Could not remove user", {
        description: err instanceof Error ? err.message : "Try again.",
      })
    },
  })

  const actorRole = authQuery.data?.user.role
  const canManage = actorRole === "OWNER" || actorRole === "ADMIN"
  const users = usersQuery.data ?? []

  function canEdit(user: AdminUser) {
    if (user.role === "OWNER") return false
    if (actorRole === "ADMIN" && user.role === "ADMIN") return false
    return actorRole === "OWNER" || actorRole === "ADMIN"
  }

  return (
    <div className="space-y-6">
      {variant === "page" ? (
        <PageHeader
          title="Users"
          description="Manage team accounts, roles, and access on this instance."
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">Signed-in account</CardTitle>
            <CardDescription className="text-zinc-600">
              The account you are using right now.
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
            <CardTitle className="text-foreground">Add user</CardTitle>
            <CardDescription className="text-zinc-600">
              {canManage
                ? "Create a local account with an initial password. No email is sent."
                : "Only the owner or an administrator can create accounts."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canManage ? (
              <p className="text-sm text-zinc-500">You do not have permission to manage users.</p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="user-name">Name</Label>
                  <Input id="user-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-email">Email</Label>
                  <Input
                    id="user-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-password">Initial password</Label>
                  <Input
                    id="user-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {actorRole === "OWNER" ? <SelectItem value="ADMIN">Admin</SelectItem> : null}
                      <SelectItem value="MEMBER">Member</SelectItem>
                      <SelectItem value="VIEWER">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  disabled={
                    createMutation.isPending || !name.trim() || !email.trim() || password.length < 8
                  }
                  onClick={() => createMutation.mutate({ name, email, password, role })}
                >
                  Create user
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground">Team members</CardTitle>
          <CardDescription className="text-zinc-600">
            Roles and status are enforced on the server for every request.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {usersQuery.isLoading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : usersQuery.isError ? (
            <p className="text-sm text-zinc-500">
              {usersQuery.error instanceof Error
                ? usersQuery.error.message
                : "Could not load users."}
            </p>
          ) : users.length === 0 ? (
            <p className="text-sm text-zinc-500">No users yet.</p>
          ) : (
            users.map((user) => (
              <div
                key={user.id}
                className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-foreground">{user.name}</p>
                  <p className="text-sm text-zinc-500">{user.email}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="secondary">{user.role}</Badge>
                    <Badge variant={user.status === "ACTIVE" ? "default" : "outline"}>
                      {user.status}
                    </Badge>
                  </div>
                </div>
                {canEdit(user) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={user.role}
                      onValueChange={(nextRole) =>
                        patchMutation.mutate({
                          id: user.id,
                          body: {
                            role: nextRole as "ADMIN" | "MEMBER" | "VIEWER",
                          },
                        })
                      }
                      disabled={
                        patchMutation.isPending ||
                        (user.role === "ADMIN" && actorRole !== "OWNER")
                      }
                    >
                      <SelectTrigger className="w-[130px]" aria-label={`Role for ${user.email}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {actorRole === "OWNER" ? <SelectItem value="ADMIN">Admin</SelectItem> : null}
                        <SelectItem value="MEMBER">Member</SelectItem>
                        <SelectItem value="VIEWER">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    {user.status === "ACTIVE" ? (
                      <ConfirmDestructiveButton
                        variant="outline"
                        title={`Disable ${user.email}?`}
                        description="They are signed out everywhere and cannot sign in until you enable the account again. Their files are kept."
                        confirmLabel="Disable account"
                        pending={patchMutation.isPending}
                        onConfirm={() =>
                          patchMutation.mutateAsync({ id: user.id, body: { status: "DISABLED" } })
                        }
                      >
                        Disable
                      </ConfirmDestructiveButton>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={patchMutation.isPending}
                        onClick={() =>
                          patchMutation.mutate({ id: user.id, body: { status: "ACTIVE" } })
                        }
                      >
                        Enable
                      </Button>
                    )}
                    <ConfirmDestructiveButton
                      title={`Remove ${user.email}?`}
                      description="The account is deleted and signed out everywhere. This cannot be undone."
                      confirmLabel="Remove account"
                      pending={deleteMutation.isPending}
                      onConfirm={() => deleteMutation.mutateAsync(user.id)}
                    >
                      Remove
                    </ConfirmDestructiveButton>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
