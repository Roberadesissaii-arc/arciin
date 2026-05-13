"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldContent, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { getRemoteAccessSettings, updateRemoteAccessSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

export function RemoteAccessPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: queryKeys.remoteAccessSettings,
    queryFn: ({ signal }) => getRemoteAccessSettings(signal),
  })
  const updateMutation = useMutation({
    mutationFn: updateRemoteAccessSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.remoteAccessSettings,
      })
    },
  })

  const [publicUrl, setPublicUrl] = useState("")
  const [reverseProxyEnabled, setReverseProxyEnabled] = useState<boolean | null>(null)
  const [cloudflareTunnelEnabled, setCloudflareTunnelEnabled] = useState<boolean | null>(null)

  const data = settingsQuery.data

  return (
    <Card className="border-white/8 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-white">Remote access</CardTitle>
        <CardDescription className="text-zinc-400">
          Arciin runs from your server first. Add a domain or tunnel only when you want
          remote access.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {data ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <div className="text-sm text-zinc-400">Local URL</div>
              <div className="mt-2 font-mono text-sm text-white">{data.localUrl}</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <div className="text-sm text-zinc-400">Current public URL</div>
              <div className="mt-2 font-mono text-sm text-white">
                {data.publicUrl || "Not configured"}
              </div>
            </div>
          </div>
        ) : null}
        <Field>
          <FieldLabel htmlFor="publicUrl">Public URL</FieldLabel>
          <Input
            id="publicUrl"
            value={publicUrl || data?.publicUrl || ""}
            placeholder="https://arciin.example.com"
            onChange={(event) => setPublicUrl(event.target.value)}
          />
        </Field>
        <div className="grid gap-3">
          <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm">
            <Checkbox
              checked={reverseProxyEnabled ?? data?.reverseProxyEnabled ?? false}
              onCheckedChange={(checked) => setReverseProxyEnabled(Boolean(checked))}
            />
            <FieldContent>
              <FieldLabel>Reverse proxy mode</FieldLabel>
              <p className="text-zinc-400">Use a local reverse proxy or Caddy in front of the app.</p>
            </FieldContent>
          </label>
          <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm">
            <Checkbox
              checked={cloudflareTunnelEnabled ?? data?.cloudflareTunnelEnabled ?? false}
              onCheckedChange={(checked) => setCloudflareTunnelEnabled(Boolean(checked))}
            />
            <FieldContent>
              <FieldLabel>Cloudflare Tunnel mode</FieldLabel>
              <p className="text-zinc-400">Optional only. Arciin does not require an external account.</p>
            </FieldContent>
          </label>
        </div>
        <Button
          className="bg-primary text-white hover:bg-primary/90"
          disabled={updateMutation.isPending}
          onClick={async () => {
            try {
              await updateMutation.mutateAsync({
                publicUrl: publicUrl || data?.publicUrl || null,
                mode:
                  (cloudflareTunnelEnabled ?? data?.cloudflareTunnelEnabled)
                    ? "cloudflare-tunnel"
                    : (reverseProxyEnabled ?? data?.reverseProxyEnabled)
                      ? "reverse-proxy"
                      : "local",
                reverseProxyEnabled:
                  reverseProxyEnabled ?? data?.reverseProxyEnabled ?? false,
                cloudflareTunnelEnabled:
                  cloudflareTunnelEnabled ?? data?.cloudflareTunnelEnabled ?? false,
              })
              toast.success("Remote access settings updated.")
            } catch (error) {
              toast.error(
                error instanceof Error ? error.message : "Could not update remote access."
              )
            }
          }}
        >
          {updateMutation.isPending ? "Saving..." : "Save remote access settings"}
        </Button>
      </CardContent>
    </Card>
  )
}
