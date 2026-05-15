"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Link2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { getRemoteAccessSettings, updateRemoteAccessSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

export function DomainPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: queryKeys.remoteAccessSettings,
    queryFn: ({ signal }) => getRemoteAccessSettings(signal),
  })
  const updateMutation = useMutation({
    mutationFn: (publicUrl: string | null) =>
      updateRemoteAccessSettings({
        publicUrl,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.remoteAccessSettings })
      toast.success("Public URL updated.")
    },
  })

  const [draft, setDraft] = useState("")

  const data = settingsQuery.data
  const effective = draft || data?.publicUrl || ""

  return (
    <Card className="border-border bg-card">
      <CardHeader className="space-y-0 text-left">
        <div className="flex items-start gap-3 pr-2">
          <Link2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1.5">
            <CardTitle className="text-left text-foreground">Domain</CardTitle>
            <CardDescription className="text-left text-zinc-600">
              <strong className="text-foreground">Local</strong> is only reachable on this machine or LAN.{" "}
              <strong className="text-foreground">Public</strong> is what Arciin prints for links and callbacks—the URL
              Cloudflare shows when you run a quick tunnel, or your own HTTPS hostname. Ingress (tunnel / proxy) lives
              under{" "}
              <Link href="/developer/web-sockets" className="font-medium text-primary underline-offset-4 hover:underline">
                WebSockets playbook
              </Link>
              .
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {data && (
          <Field>
            <FieldLabel htmlFor="domain-local-url">Local base URL</FieldLabel>
            <FieldDescription>
              Not exposed to the internet. Browsers on this host use this until a public URL is set.
            </FieldDescription>
            <Input
              id="domain-local-url"
              readOnly
              value={data.localUrl ?? ""}
              className="font-mono text-muted-foreground"
              tabIndex={-1}
            />
          </Field>
        )}

        <Field>
          <FieldLabel htmlFor="domain-public-url">Public base URL</FieldLabel>
          <FieldDescription>
            Optional until you have a reachable HTTPS URL. With Cloudflare quick tunnel, the CLI prints something like{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">https://random.trycloudflare.com</code>—paste
            that here (no paid domain). Your own domain works too once DNS points at your tunnel or reverse proxy.
          </FieldDescription>
          <Input
            id="domain-public-url"
            value={effective}
            placeholder="https://xxxx.trycloudflare.com or https://arciin.example.com"
            onChange={(e) => setDraft(e.target.value)}
            disabled={settingsQuery.isLoading}
            className="font-mono"
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button
            className="bg-primary text-white hover:bg-primary/90"
            disabled={updateMutation.isPending || settingsQuery.isLoading}
            onClick={async () => {
              const trimmed = effective.trim()
              try {
                await updateMutation.mutateAsync(trimmed === "" ? null : trimmed)
                setDraft("")
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Could not save domain.")
              }
            }}
          >
            {updateMutation.isPending ? "Saving…" : "Save public URL"}
          </Button>
          <Button variant="outline" asChild className="border-border">
            <Link href="/developer/web-sockets" className="gap-1">
              Ingress playbook
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
