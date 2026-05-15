"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { SOCKET_EVENT_TYPES } from "@arciin/shared"
import { Copy, Plus, RefreshCcw, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  createWebhookEndpoint,
  deleteWebhookEndpoint,
  listWebhookDeliveries,
  listWebhooks,
  testWebhookEndpoint,
  updateWebhookEndpoint,
} from "@/lib/api/webhooks"
import { queryKeys } from "@/lib/api/query-keys"
import type { SocketEventType } from "@arciin/shared"
import type { WebhookEndpointSummary } from "@/lib/types/models"

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="border-border bg-card text-foreground hover:bg-muted/50"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          toast.success(`${label} copied.`)
        } catch {
          toast.error("Could not copy to clipboard.")
        }
      }}
    >
      <Copy className="size-4" />
      Copy
    </Button>
  )
}

function EndpointForm({
  mode,
  initial,
  onCancel,
  onSaved,
}: {
  mode: "create" | "edit"
  initial?: WebhookEndpointSummary
  onCancel: () => void
  onSaved: (result: { endpoint: WebhookEndpointSummary; secret?: string | null }) => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(initial?.name ?? "")
  const [url, setUrl] = useState(initial?.url ?? "")
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true)
  const [rotateSecret, setRotateSecret] = useState(false)
  const [eventTypes, setEventTypes] = useState<SocketEventType[]>(
    (initial?.eventTypes as SocketEventType[] | undefined) ?? ["activity.created"]
  )

  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "create") {
        return createWebhookEndpoint({ name, url, enabled, eventTypes })
      }
      if (!initial) {
        throw new Error("Missing endpoint")
      }
      return updateWebhookEndpoint(initial.id, { name, url, enabled, eventTypes, rotateSecret })
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.webhooks })
      onSaved({ endpoint: data.endpoint, secret: data.secret })
    },
    onError: (e: Error) => toast.error(e.message || "Could not save webhook."),
  })

  const isValid = name.trim().length >= 2 && url.trim().length > 0 && eventTypes.length > 0

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-foreground">{mode === "create" ? "Create webhook" : "Edit webhook"}</CardTitle>
        <CardDescription className="text-zinc-600">
          Webhooks receive JSON POST requests. We sign each request with your secret.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="webhookName">Name</FieldLabel>
            <Input id="webhookName" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="webhookUrl">Endpoint URL</FieldLabel>
            <Input
              id="webhookUrl"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/arciin/webhooks"
            />
          </Field>
        </div>

        <label className="flex items-start gap-3 rounded-2xl border border-border bg-muted/50 p-4 text-sm">
          <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(Boolean(checked))} />
          <FieldContent>
            <FieldLabel>Enabled</FieldLabel>
            <p className="text-zinc-600">Disabled webhooks will not receive deliveries.</p>
          </FieldContent>
        </label>

        {mode === "edit" ? (
          <label className="flex items-start gap-3 rounded-2xl border border-border bg-muted/50 p-4 text-sm">
            <Checkbox
              checked={rotateSecret}
              onCheckedChange={(checked) => setRotateSecret(Boolean(checked))}
            />
            <FieldContent>
              <FieldLabel>Rotate secret</FieldLabel>
              <p className="text-zinc-600">Generates a new signing secret (shown once after saving).</p>
            </FieldContent>
          </label>
        ) : null}

        <div className="space-y-3">
          <div className="text-sm font-medium text-foreground">Event types</div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {SOCKET_EVENT_TYPES.map((eventType) => {
              const checked = eventTypes.includes(eventType)
              return (
                <label
                  key={eventType}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-muted/50 p-4 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(next) => {
                      const value = Boolean(next)
                      setEventTypes((prev) =>
                        value ? Array.from(new Set([...prev, eventType])) : prev.filter((t) => t !== eventType)
                      )
                    }}
                  />
                  <div className="min-w-0">
                    <div className="font-mono text-[12px] text-foreground/90">{eventType}</div>
                    <div className="text-[12px] font-medium text-zinc-600">Subscribe</div>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="border-border bg-card text-foreground hover:bg-muted/50"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-primary text-white hover:bg-primary/90"
            disabled={!isValid || mutation.isPending}
            onClick={async () => {
              try {
                await mutation.mutateAsync()
                toast.success(mode === "create" ? "Webhook created." : "Webhook updated.")
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not save webhook.")
              }
            }}
          >
            {mutation.isPending ? "Saving..." : mode === "create" ? "Create webhook" : "Save changes"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DeliveryTable({ endpointId }: { endpointId: string }) {
  const deliveriesQuery = useQuery({
    queryKey: queryKeys.webhookDeliveries(endpointId),
    queryFn: ({ signal }) => listWebhookDeliveries(endpointId, signal),
  })

  if (deliveriesQuery.isLoading) {
    return <Skeleton className="h-48 rounded-3xl" />
  }

  if (deliveriesQuery.isError) {
    return (
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-800">
        {deliveriesQuery.error instanceof Error
          ? deliveriesQuery.error.message
          : "Could not load deliveries."}
      </div>
    )
  }

  const deliveries = deliveriesQuery.data ?? []

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-foreground">Recent deliveries</CardTitle>
        <CardDescription className="text-zinc-600">Last 50 attempts for this endpoint.</CardDescription>
      </CardHeader>
      <CardContent>
        {deliveries.length === 0 ? (
          <div className="text-sm font-medium text-zinc-600">No deliveries yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-semibold text-zinc-700">Time</TableHead>
                  <TableHead className="font-semibold text-zinc-700">Event</TableHead>
                  <TableHead className="font-semibold text-zinc-700">Status</TableHead>
                  <TableHead className="font-semibold text-zinc-700">HTTP</TableHead>
                  <TableHead className="text-right font-semibold text-zinc-700">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap text-sm text-zinc-600">
                      {new Date(d.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="font-mono text-[12px] text-foreground/90">{d.eventType}</TableCell>
                    <TableCell className="text-sm">
                      <span
                        className={
                          d.status === "SUCCESS"
                            ? "font-medium text-emerald-700"
                            : d.status === "FAILED"
                              ? "font-medium text-red-700"
                              : "font-medium text-zinc-600"
                        }
                      >
                        {d.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-zinc-600">{d.responseCode ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm text-zinc-600">
                      {d.durationMs != null ? `${d.durationMs}ms` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function WebhooksManager() {
  const queryClient = useQueryClient()
  const endpointsQuery = useQuery({
    queryKey: queryKeys.webhooks,
    queryFn: ({ signal }) => listWebhooks(signal),
  })

  const [mode, setMode] = useState<null | { kind: "create" } | { kind: "edit"; endpoint: WebhookEndpointSummary }>(null)
  const [secretToShow, setSecretToShow] = useState<{ endpointId: string; secret: string } | null>(null)
  const [activeEndpointId, setActiveEndpointId] = useState<string | null>(null)

  const deleteMutation = useMutation({
    mutationFn: deleteWebhookEndpoint,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.webhooks })
    },
    onError: (e: Error) => toast.error(e.message || "Could not delete webhook."),
  })

  const testMutation = useMutation({
    mutationFn: testWebhookEndpoint,
    onSuccess: async (_data, endpointId) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.webhookDeliveries(endpointId) })
    },
    onError: (e: Error) => toast.error(e.message || "Could not send test event."),
  })

  const endpoints = useMemo(() => endpointsQuery.data ?? [], [endpointsQuery.data])
  const active = useMemo(
    () => endpoints.find((e) => e.id === activeEndpointId) ?? endpoints[0] ?? null,
    [activeEndpointId, endpoints]
  )

  return (
    <div className="space-y-6 pb-6">
      <DashboardPageIntro
        title="Webhooks"
        subtitle="HTTPS endpoints · signed payloads · delivery history"
        description="Forward the same event names Socket.IO uses to your own HTTP services. Each delivery includes a signature header so receivers can verify Arciin—not a third party—sent the payload."
        actions={
          <Button
            className="bg-primary text-white hover:bg-primary/90"
            onClick={() => {
              setMode({ kind: "create" })
              setSecretToShow(null)
            }}
          >
            <Plus className="size-4" />
            Create webhook
          </Button>
        }
        stats={[
          {
            label: "Endpoints",
            value: endpointsQuery.isLoading ? "…" : endpoints.length.toLocaleString(),
          },
          {
            label: "Event types",
            value: SOCKET_EVENT_TYPES.length.toLocaleString(),
          },
          { label: "Payload signing", value: "HMAC" },
          { label: "Transport", value: "HTTPS POST" },
        ]}
      />

      {secretToShow ? (
        <Card className="border-[#FF4F12]/25 bg-[#FF4F12]/[0.06]">
          <CardHeader>
            <CardTitle className="text-foreground">Webhook secret</CardTitle>
            <CardDescription className="text-zinc-600">
              This secret is shown once. Store it securely.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="w-full rounded-xl border border-border bg-muted/60 px-3 py-2 font-mono text-[12px] text-zinc-900 sm:max-w-[520px]">
              {secretToShow.secret}
            </code>
            <CopyButton value={secretToShow.secret} label="Secret" />
          </CardContent>
        </Card>
      ) : null}

      {mode ? (
        <EndpointForm
          mode={mode.kind}
          initial={mode.kind === "edit" ? mode.endpoint : undefined}
          onCancel={() => setMode(null)}
          onSaved={({ endpoint, secret }) => {
            setMode(null)
            setActiveEndpointId(endpoint.id)
            if (secret) {
              setSecretToShow({ endpointId: endpoint.id, secret })
            } else {
              setSecretToShow(null)
            }
          }}
        />
      ) : null}

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground">Endpoints</CardTitle>
          <CardDescription className="text-zinc-600">
            Create an endpoint, then use “Test delivery” to confirm it can receive signed requests.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {endpointsQuery.isLoading ? (
            <Skeleton className="h-36 rounded-3xl" />
          ) : endpoints.length === 0 ? (
            <div className="space-y-2 text-sm font-medium text-zinc-700">
              <p>No webhooks yet.</p>
              <p>Create one to start delivering events.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-semibold text-zinc-700">Name</TableHead>
                    <TableHead className="font-semibold text-zinc-700">URL</TableHead>
                    <TableHead className="font-semibold text-zinc-700">Status</TableHead>
                    <TableHead className="font-semibold text-zinc-700">Secret</TableHead>
                    <TableHead className="text-right font-semibold text-zinc-700">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpoints.map((endpoint) => (
                    <TableRow
                      key={endpoint.id}
                      className={endpoint.id === active?.id ? "bg-card" : undefined}
                      onClick={() => setActiveEndpointId(endpoint.id)}
                    >
                      <TableCell className="font-medium text-foreground">{endpoint.name}</TableCell>
                      <TableCell className="font-mono text-[12px] text-foreground/80">{endpoint.url}</TableCell>
                      <TableCell className="text-sm">
                        <span className={endpoint.enabled ? "font-medium text-emerald-700" : "font-medium text-zinc-600"}>
                          {endpoint.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-[12px] text-muted-foreground">
                        {endpoint.secretPrefix}…
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="border-border bg-card text-foreground hover:bg-muted/50"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setMode({ kind: "edit", endpoint })
                              setSecretToShow(null)
                            }}
                          >
                            <RefreshCcw className="size-4" />
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="border-border bg-card text-foreground hover:bg-muted/50"
                            disabled={testMutation.isPending}
                            onClick={async (e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              try {
                                await testMutation.mutateAsync(endpoint.id)
                                toast.success("Test delivery sent.")
                              } catch (error) {
                                toast.error(error instanceof Error ? error.message : "Test delivery failed.")
                              }
                            }}
                          >
                            <Send className="size-4" />
                            Test
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="border-border bg-card text-red-200 hover:bg-muted/50"
                            disabled={deleteMutation.isPending}
                            onClick={async (e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              try {
                                await deleteMutation.mutateAsync(endpoint.id)
                                toast.success("Webhook deleted.")
                                if (activeEndpointId === endpoint.id) {
                                  setActiveEndpointId(null)
                                }
                              } catch (error) {
                                toast.error(error instanceof Error ? error.message : "Could not delete webhook.")
                              }
                            }}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {active ? <DeliveryTable endpointId={active.id} /> : null}
    </div>
  )
}

