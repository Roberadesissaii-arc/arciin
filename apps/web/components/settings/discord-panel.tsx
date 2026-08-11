"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Loader2, MessageSquare, Send, Trash2 } from "lucide-react"

import { toast } from "@/lib/notifications/arciin-toast"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"
import {
  clearDiscordSettings,
  getDiscordSettings,
  sendDiscordTest,
  updateDiscordSettings,
} from "@/lib/api/settings"

/**
 * Discord delivery.
 *
 * A webhook URL is a bearer credential — anyone holding it can post to the
 * channel — so it is write-only here, exactly like the SMTP password. The API
 * reports whether one is stored and nothing else.
 */
export function DiscordPanel() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ["settings", "discord"],
    queryFn: ({ signal }) => getDiscordSettings(signal),
  })

  const [webhookUrl, setWebhookUrl] = useState("")
  const [notifyOnUrlChange, setNotifyOnUrlChange] = useState(true)

  const data = query.data

  // Adjust state during render rather than in an effect — see EmailPanel.
  const [hydratedFrom, setHydratedFrom] = useState<typeof data>(undefined)
  if (data && data !== hydratedFrom) {
    setHydratedFrom(data)
    setNotifyOnUrlChange(data.notifyOnUrlChange)
    setWebhookUrl("")
  }

  const saveMutation = useMutation({
    mutationFn: updateDiscordSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "discord"] })
      setWebhookUrl("")
      toast.success("Discord settings saved.")
    },
    onError: (err) =>
      toast.error("Could not save Discord settings", {
        description: err instanceof Error ? err.message : "Check the webhook URL.",
      }),
  })

  const testMutation = useMutation({
    mutationFn: sendDiscordTest,
    onSuccess: () => toast.success("Posted to your Discord channel."),
    onError: (err) =>
      toast.error("Discord test failed", {
        description: err instanceof Error ? err.message : "Check the webhook URL.",
      }),
  })

  const clearMutation = useMutation({
    mutationFn: clearDiscordSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "discord"] })
      toast.success("Discord webhook removed.")
    },
  })

  if (query.isLoading) return <Skeleton className="h-72 w-full rounded-2xl" />

  if (query.isError || !data) {
    return (
      <SettingsPanelError
        message={
          query.error instanceof Error ? query.error.message : "Could not load Discord settings."
        }
        hint="Check that the API is running, then refresh this page."
      />
    )
  }

  const canSave = data.configured || webhookUrl.trim().length > 0

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/25">
          <MessageSquare className="size-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-foreground">Discord</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
            Get your new address posted to a Discord channel, and ask the assistant to send files
            there from chat.
          </p>
        </div>
        {data.configured ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground">
            <CheckCircle2 className="size-3.5 text-primary" />
            Connected
          </span>
        ) : null}
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <Field>
          <FieldLabel htmlFor="discord-webhook">Webhook URL</FieldLabel>
          <Input
            id="discord-webhook"
            type="password"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder={
              data.configured
                ? "Saved — leave blank to keep"
                : "https://discord.com/api/webhooks/…"
            }
            autoComplete="off"
            data-testid="discord-webhook"
          />
          <FieldDescription>
            In Discord: Channel settings → Integrations → Webhooks → New Webhook → Copy URL. Anyone
            with this URL can post to that channel, so it is stored encrypted and never shown again.
          </FieldDescription>
        </Field>

        <label className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/20 p-3 text-[13px]">
          <Checkbox
            checked={notifyOnUrlChange}
            onCheckedChange={(v) => setNotifyOnUrlChange(v === true)}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium text-foreground">Post my new address here</span>
            <span className="mt-0.5 block text-muted-foreground">
              Sent whenever the tunnel restarts with a new hostname — the same message email gets.
            </span>
          </span>
        </label>

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-[13px] font-medium text-foreground">From chat</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            Once connected, you can say <em>&ldquo;send that file to my Discord&rdquo;</em> and the
            assistant will post it. It can only send to this channel — it cannot be talked into
            sending your files anywhere else.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            onClick={() =>
              saveMutation.mutate({
                webhookUrl: webhookUrl.trim() || undefined,
                notifyOnUrlChange,
                enabled: true,
              })
            }
            disabled={!canSave || saveMutation.isPending}
            className="gap-2"
            data-testid="discord-save"
          >
            {saveMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
          <Button
            variant="outline"
            onClick={() => testMutation.mutate()}
            disabled={!data.configured || testMutation.isPending}
            className="gap-2"
            data-testid="discord-test"
          >
            {testMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Send test
          </Button>
          {data.configured ? (
            <Button
              variant="ghost"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
              className="gap-2 text-muted-foreground"
            >
              <Trash2 className="size-4" />
              Disconnect
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
