"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check,
  Cloud,
  HardDrive,
  Loader2,
  Plug,
  ShieldCheck,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  disconnectRunPod,
  getAudioSeparationSettings,
  saveRunPodConnection,
  testRunPodConnection,
  type ConnectionTestResult,
  type RunPodConnectionInput,
} from "@/lib/api/audio-separation"
import { toast } from "@/lib/notifications/arciin-toast"
import { cn } from "@/lib/utils"

/**
 * Choosing and connecting the thing that separates dialogue from background.
 *
 * Separation is the expensive half of a dub and the half that reads the
 * original audio — two and a half hours on this server's CPU for a
 * twelve-minute video — so where it runs is a decision about someone's own
 * media, and it belongs in settings rather than buried in a job.
 *
 * The secrets are entered here and never come back. The server stores them
 * encrypted and has no read path that returns one, so after saving, the only
 * thing this page can show is a masked identifier and whatever the last
 * connection test found.
 */

const SEPARATION_QUERY_KEY = ["settings", "audio-separation"] as const

const EMPTY_FORM: RunPodConnectionInput = {
  apiKey: "",
  endpointId: "",
  volumeId: "",
  datacenter: "",
  s3AccessKeyId: "",
  s3SecretAccessKey: "",
}

export function AudioSeparationPanel() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<RunPodConnectionInput>(EMPTY_FORM)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  const settings = useQuery({
    queryKey: SEPARATION_QUERY_KEY,
    queryFn: ({ signal }) => getAudioSeparationSettings(signal),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: SEPARATION_QUERY_KEY })

  const save = useMutation({
    mutationFn: saveRunPodConnection,
    onSuccess: () => {
      /**
       * Cleared the moment it leaves.
       *
       * The values are already encrypted server-side and will never be returned,
       * so keeping them in component state would be the only remaining copy in
       * the browser — and the least protected one.
       */
      setForm(EMPTY_FORM)
      setShowForm(false)
      setTestResult(null)
      void invalidate()
      toast.success("RunPod connected", { description: "Run a connection test to verify it." })
    },
    onError: (error) => {
      toast.error("Could not save the connection", {
        description: error instanceof Error ? error.message : "Check the fields and try again.",
      })
    },
  })

  const test = useMutation({
    mutationFn: testRunPodConnection,
    onSuccess: (result) => {
      setTestResult(result)
      void invalidate()
    },
    onError: (error) => {
      toast.error("Connection test failed to run", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    },
  })

  const disconnect = useMutation({
    mutationFn: disconnectRunPod,
    onSuccess: () => {
      setTestResult(null)
      void invalidate()
      toast.success("RunPod disconnected", {
        // Worth saying: disconnecting a provider is not a request to destroy
        // the work it helped produce.
        description: "Your dubs, cached separations and media are untouched.",
      })
    },
  })

  const data = settings.data
  const runpod = data?.runpod

  return (
    <Card data-testid="audio-separation-panel">
      <CardHeader>
        <h2 className="text-[15px] font-semibold text-foreground">Audio separation</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Dubbing splits dialogue from music and ambience before it generates new speech. This is
          the slowest part of a dub, and where it runs is up to you.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ── local ────────────────────────────────────────────────────── */}
        <section data-testid="separation-local">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Local
          </p>
          <div className="mt-2 flex items-start justify-between gap-3 rounded-lg border border-border p-3">
            <div className="flex items-start gap-2.5">
              <HardDrive className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-[13px] font-medium text-foreground">
                  {data?.local.engine ?? "Demucs"} · this server
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Private. The source audio never leaves Arciin to be separated.
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground/80">
                  {data?.local.implementation} · {data?.local.compute}
                </p>
              </div>
            </div>
            <StatusPill
              ok={data?.local.available ?? false}
              okLabel="Available"
              failLabel="Not installed"
              testId="separation-local-status"
            />
          </div>
        </section>

        {/* ── cloud ────────────────────────────────────────────────────── */}
        <section data-testid="separation-cloud">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Cloud
          </p>

          <div className="mt-2 rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Cloud className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <p className="text-[13px] font-medium text-foreground">RunPod</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    GPU separation. Much faster for long videos; the source audio is uploaded to
                    RunPod to be processed.
                  </p>
                </div>
              </div>
              <StatusPill
                ok={runpod?.configured ?? false}
                okLabel="Connected"
                failLabel="Not connected"
                testId="separation-runpod-status"
              />
            </div>

            {runpod?.configured && !showForm ? (
              <>
                <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[12px]">
                  <dt className="text-muted-foreground">Endpoint</dt>
                  <dd className="font-mono text-foreground" data-testid="runpod-endpoint">
                    {runpod.endpointDisplay}
                  </dd>
                  <dt className="text-muted-foreground">Volume</dt>
                  <dd className="font-mono text-foreground">{runpod.volumeDisplay}</dd>
                  <dt className="text-muted-foreground">Datacenter</dt>
                  <dd className="text-foreground">{runpod.datacenter}</dd>
                  {runpod.lastTest ? (
                    <>
                      <dt className="text-muted-foreground">GPU</dt>
                      <dd className="text-foreground" data-testid="runpod-gpu">
                        {runpod.lastTest.gpuName ?? "—"}
                      </dd>
                      <dt className="text-muted-foreground">Separator</dt>
                      <dd className="text-foreground">
                        {runpod.lastTest.separatorVersion ?? "—"}
                        {runpod.lastTest.model ? ` · ${runpod.lastTest.model}` : ""}
                      </dd>
                    </>
                  ) : null}
                </dl>

                {testResult ? <TestResults result={testResult} /> : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={test.isPending}
                    onClick={() => test.mutate()}
                    data-testid="runpod-test"
                  >
                    {test.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Plug className="size-3.5" />
                    )}
                    Test connection
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowForm(true)}
                    data-testid="runpod-edit"
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disconnect.isPending}
                    onClick={() => disconnect.mutate()}
                    data-testid="runpod-disconnect"
                  >
                    Disconnect
                  </Button>
                </div>
              </>
            ) : null}

            {!runpod?.configured && !showForm ? (
              <Button
                type="button"
                size="sm"
                className="mt-3"
                onClick={() => setShowForm(true)}
                data-testid="runpod-connect"
              >
                <Plug className="size-3.5" />
                Connect
              </Button>
            ) : null}

            {showForm ? (
              <ConnectForm
                form={form}
                onChange={setForm}
                onCancel={() => {
                  setForm(EMPTY_FORM)
                  setShowForm(false)
                }}
                onSubmit={() => save.mutate(form)}
                saving={save.isPending}
              />
            ) : null}
          </div>
        </section>

        {/* Stated here as well as in the dubbing panel, because this is where
            someone decides whether to turn cloud processing on at all. */}
        <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Voice generation always uses Gemini and receives the translated text and voice
            directions — never the video. Only separation is affected by this setting.
          </span>
        </p>
      </CardContent>
    </Card>
  )
}

function StatusPill({
  ok,
  okLabel,
  failLabel,
  testId,
}: {
  ok: boolean
  okLabel: string
  failLabel: string
  testId: string
}) {
  return (
    <span
      data-testid={testId}
      data-ok={ok}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium",
        ok ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground",
      )}
    >
      {ok ? <Check className="size-3" aria-hidden /> : null}
      {ok ? okLabel : failLabel}
    </span>
  )
}

/**
 * The five layers, each reported separately.
 *
 * "Connected" must not mean "a key was typed in": a valid key against a deleted
 * endpoint, a volume in the wrong datacenter and a worker quietly running on
 * CPU all look identical if only the first layer is checked.
 */
function TestResults({ result }: { result: ConnectionTestResult }) {
  return (
    <div className="mt-3 space-y-1 rounded-lg border border-border bg-muted/30 p-2.5" data-testid="runpod-test-results">
      {result.layers.map((layer) => (
        <div key={layer.layer} className="flex items-start gap-2 text-[12px]">
          {layer.ok ? (
            <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <X className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden />
          )}
          <span className="min-w-[130px] text-foreground">{layer.label}</span>
          <span className="min-w-0 flex-1 text-muted-foreground" data-testid={`runpod-layer-${layer.layer}`}>
            {layer.ok ? (layer.detail ?? "") : (layer.reason ?? "Failed")}
            {layer.ok && layer.reason ? ` ${layer.reason}` : ""}
          </span>
        </div>
      ))}
    </div>
  )
}

function ConnectForm({
  form,
  onChange,
  onCancel,
  onSubmit,
  saving,
}: {
  form: RunPodConnectionInput
  onChange: (next: RunPodConnectionInput) => void
  onCancel: () => void
  onSubmit: () => void
  saving: boolean
}) {
  const set = (field: keyof RunPodConnectionInput, value: string) =>
    onChange({ ...form, [field]: value })

  const complete = Object.values(form).every((value) => value.trim().length > 0)

  return (
    <form
      className="mt-3 space-y-3 border-t border-border pt-3"
      data-testid="runpod-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (complete) onSubmit()
      }}
    >
      {/*
        Two credentials, and the reason is stated.

        Using the RunPod API key where the S3 key belongs is the most common
        setup mistake, and the resulting error — "access denied" against a
        perfectly valid account — gives no hint which one was wrong.
      */}
      <p className="text-[11.5px] text-muted-foreground">
        RunPod uses two separate credentials: an API key for the endpoint, and an S3 key pair for
        the network volume. Generate the S3 key under Settings → S3 API keys in the RunPod console.
      </p>

      <Field label="RunPod API key" htmlFor="runpod-api-key">
        <Input
          id="runpod-api-key"
          type="password"
          autoComplete="off"
          value={form.apiKey}
          onChange={(e) => set("apiKey", e.target.value)}
          data-testid="runpod-field-apiKey"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Serverless endpoint ID" htmlFor="runpod-endpoint-id">
          <Input
            id="runpod-endpoint-id"
            value={form.endpointId}
            onChange={(e) => set("endpointId", e.target.value)}
            data-testid="runpod-field-endpointId"
          />
        </Field>
        <Field label="Network volume ID" htmlFor="runpod-volume">
          <Input
            id="runpod-volume"
            value={form.volumeId}
            onChange={(e) => set("volumeId", e.target.value)}
            data-testid="runpod-field-volumeId"
          />
        </Field>
      </div>

      <Field label="Datacenter" htmlFor="runpod-datacenter" hint="e.g. eu-cz-1 — must match the volume's">
        <Input
          id="runpod-datacenter"
          value={form.datacenter}
          onChange={(e) => set("datacenter", e.target.value)}
          data-testid="runpod-field-datacenter"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="S3 access key" htmlFor="runpod-s3-key">
          <Input
            id="runpod-s3-key"
            type="password"
            autoComplete="off"
            value={form.s3AccessKeyId}
            onChange={(e) => set("s3AccessKeyId", e.target.value)}
            data-testid="runpod-field-s3AccessKeyId"
          />
        </Field>
        <Field label="S3 secret" htmlFor="runpod-s3-secret">
          <Input
            id="runpod-s3-secret"
            type="password"
            autoComplete="off"
            value={form.s3SecretAccessKey}
            onChange={(e) => set("s3SecretAccessKey", e.target.value)}
            data-testid="runpod-field-s3SecretAccessKey"
          />
        </Field>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!complete || saving} data-testid="runpod-save">
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Save connection
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={htmlFor} className="text-[12px] text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground/80">{hint}</p> : null}
    </div>
  )
}
