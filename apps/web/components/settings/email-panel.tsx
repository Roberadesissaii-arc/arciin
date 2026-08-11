"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Mail, Send, Trash2 } from "lucide-react"

import { toast } from "@/lib/notifications/arciin-toast"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"
import {
  clearEmailSettings,
  emailCurrentPublicUrl,
  getEmailSettings,
  sendEmailTest,
  updateEmailSettings,
} from "@/lib/api/settings"

/**
 * SMTP settings.
 *
 * Exists so the instance can mail you its new address when the tunnel restarts.
 * That restart normally happens unattended — a reboot, a crash — and the person
 * who needs the new link is the one who is not at the server.
 *
 * The password is write-only: it is never sent back by the API, so the field
 * renders empty and an empty field means "leave it alone".
 */
export function EmailPanel() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ["settings", "email"],
    queryFn: ({ signal }) => getEmailSettings(signal),
  })

  const [host, setHost] = useState("")
  const [port, setPort] = useState("587")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [fromAddress, setFromAddress] = useState("")
  const [fromName, setFromName] = useState("")
  const [notifyAddress, setNotifyAddress] = useState("")
  const [notifyOnUrlChange, setNotifyOnUrlChange] = useState(true)

  const data = query.data

  // Adjust state during render rather than in an effect: an effect here fires
  // after paint and causes a second render pass, which this codebase lints
  // against. TanStack Query's structural sharing keeps `data` referentially
  // stable when nothing changed, so a background refetch will not stomp on
  // whatever the user is currently typing.
  const [hydratedFrom, setHydratedFrom] = useState<typeof data>(undefined)
  if (data && data !== hydratedFrom) {
    setHydratedFrom(data)
    setHost(data.host ?? "")
    setPort(data.port ? String(data.port) : "587")
    setUsername(data.username ?? "")
    setFromAddress(data.fromAddress ?? "")
    setFromName(data.fromName ?? "")
    setNotifyAddress(data.notifyAddress ?? "")
    setNotifyOnUrlChange(data.notifyOnUrlChange)
    // Never populated from the server — it is not returned, by design.
    setPassword("")
  }

  const saveMutation = useMutation({
    mutationFn: updateEmailSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "email"] })
      setPassword("")
      toast.success("Email settings saved.")
    },
    onError: (err) =>
      toast.error("Could not save email settings", {
        description: err instanceof Error ? err.message : "Check the values and try again.",
      }),
  })

  const testMutation = useMutation({
    mutationFn: sendEmailTest,
    onSuccess: (result) =>
      toast.success("Test email sent.", { description: `Delivered to ${result.to}.` }),
    onError: (err) =>
      toast.error("Test email failed", {
        description: err instanceof Error ? err.message : "Check the SMTP details.",
      }),
  })

  const sendUrlMutation = useMutation({
    mutationFn: emailCurrentPublicUrl,
    onSuccess: () => toast.success("Current address emailed to you."),
    onError: (err) =>
      toast.error("Could not send the address", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      }),
  })

  const clearMutation = useMutation({
    mutationFn: clearEmailSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "email"] })
      toast.success("Email settings removed.")
    },
  })

  if (query.isLoading) {
    return <Skeleton className="h-96 w-full rounded-2xl" />
  }

  if (query.isError || !data) {
    return (
      <SettingsPanelError
        message={
          query.error instanceof Error ? query.error.message : "Could not load email settings."
        }
        hint="Check that the API is running, then refresh this page."
      />
    )
  }

  const portNumber = Number.parseInt(port, 10)
  const canSave =
    host.trim().length > 0 &&
    Number.isFinite(portNumber) &&
    portNumber > 0 &&
    fromAddress.trim().length > 0 &&
    // A brand-new configuration needs a password; an existing one may keep its.
    (data.hasPassword || password.length > 0 || username.trim().length === 0)

  function handleSave() {
    saveMutation.mutate({
      host: host.trim(),
      port: portNumber,
      secure: portNumber === 465,
      username: username.trim() || null,
      // Undefined means "unchanged" — the whole point of the write-only field.
      password: password.length > 0 ? password : undefined,
      fromAddress: fromAddress.trim(),
      fromName: fromName.trim() || null,
      notifyAddress: notifyAddress.trim() || null,
      notifyOnUrlChange,
    })
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/25">
            <Mail className="size-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-foreground">Email notifications</h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
              Your address changes every time the secure tunnel restarts. Arciin can email you the
              new link so you are not locked out when you are away from home.
            </p>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
            <Field>
              <FieldLabel htmlFor="smtp-host">SMTP server</FieldLabel>
              <Input
                id="smtp-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="smtp.gmail.com"
                autoComplete="off"
                data-testid="email-host"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="smtp-port">Port</FieldLabel>
              <Input
                id="smtp-port"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="587"
                data-testid="email-port"
              />
            </Field>
          </div>
          <FieldDescription>
            587 uses STARTTLS, 465 uses implicit TLS. Most providers want 587.
          </FieldDescription>

          <Field>
            <FieldLabel htmlFor="smtp-username">Username</FieldLabel>
            <Input
              id="smtp-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="you@example.com"
              autoComplete="off"
              data-testid="email-username"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="smtp-password">Password</FieldLabel>
            <Input
              id="smtp-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={data.hasPassword ? "Saved — leave blank to keep" : "App password"}
              autoComplete="new-password"
              data-testid="email-password"
            />
            <FieldDescription>
              Use an app password, not your main account password. Stored encrypted on this server
              and never shown again.
            </FieldDescription>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="smtp-from">Send from</FieldLabel>
              <Input
                id="smtp-from"
                type="email"
                value={fromAddress}
                onChange={(e) => setFromAddress(e.target.value)}
                placeholder="arciin@example.com"
                data-testid="email-from"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="smtp-from-name">Sender name</FieldLabel>
              <Input
                id="smtp-from-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Arciin"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="smtp-notify">Send notifications to</FieldLabel>
            <Input
              id="smtp-notify"
              type="email"
              value={notifyAddress}
              onChange={(e) => setNotifyAddress(e.target.value)}
              placeholder={data.effectiveNotifyAddress ?? "your@email.com"}
              data-testid="email-notify"
            />
            <FieldDescription>
              Leave blank to use your account email
              {data.effectiveNotifyAddress ? ` (${data.effectiveNotifyAddress})` : ""}.
            </FieldDescription>
          </Field>

          <label className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/20 p-3 text-[13px]">
            <Checkbox
              checked={notifyOnUrlChange}
              onCheckedChange={(v) => setNotifyOnUrlChange(v === true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-foreground">Email me when my address changes</span>
              <span className="mt-0.5 block text-muted-foreground">
                Sent automatically whenever the tunnel restarts with a new hostname.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              onClick={handleSave}
              disabled={!canSave || saveMutation.isPending}
              className="gap-2"
              data-testid="email-save"
            >
              {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save settings
            </Button>
            <Button
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={!data.configured || testMutation.isPending}
              className="gap-2"
              data-testid="email-test"
            >
              {testMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              Send test
            </Button>
            <Button
              variant="outline"
              onClick={() => sendUrlMutation.mutate()}
              disabled={!data.configured || sendUrlMutation.isPending}
              className="gap-2"
            >
              {sendUrlMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Email me the current link
            </Button>
            {data.configured ? (
              <Button
                variant="ghost"
                onClick={() => clearMutation.mutate()}
                disabled={clearMutation.isPending}
                className="gap-2 text-muted-foreground"
              >
                <Trash2 className="size-4" />
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  )
}
