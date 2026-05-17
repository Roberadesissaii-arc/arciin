"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BrainCircuit, CheckCircle2, Circle, Cpu, ExternalLink, Server } from "lucide-react"
import { toast } from "sonner"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  deleteModelProfile,
  getAvailableModels,
  getModelProfiles,
  setDefaultModelProfile,
} from "@/lib/api/models"
import { queryKeys } from "@/lib/api/query-keys"
import type { ModelProfile } from "@/lib/types/models"

function ModelProfileCard({ profile, onSetDefault }: { profile: ModelProfile; onSetDefault: (id: string) => void }) {
  const availableQuery = useQuery({
    queryKey: ["models", profile.id, "available"],
    queryFn: ({ signal }) => getAvailableModels(profile.id, signal),
    retry: false,
    staleTime: 30_000,
  })

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <Cpu className="size-4 shrink-0 text-primary" aria-hidden />
              <CardTitle className="text-base text-foreground">{profile.displayName}</CardTitle>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-wide text-zinc-500">
              {String(profile.provider)}
            </p>
            {profile.baseUrl && (
              <CardDescription className="flex items-center gap-1 font-mono text-[11px]">
                <Server className="size-3" />
                {profile.baseUrl}
              </CardDescription>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {profile.isDefault && (
              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700">
                <CheckCircle2 className="mr-1 size-3" />
                Default
              </Badge>
            )}
            {!profile.isDefault && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 border-border text-xs"
                onClick={() => onSetDefault(profile.id)}
              >
                <Circle className="mr-1 size-3" />
                Set default
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {profile.defaultModel && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <BrainCircuit className="size-4 shrink-0 text-primary" />
            <span className="text-[13px] font-medium text-foreground">{profile.defaultModel}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">Default model</span>
          </div>
        )}
        {availableQuery.isSuccess && availableQuery.data.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              Available models ({availableQuery.data.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {availableQuery.data.slice(0, 12).map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-zinc-600"
                >
                  {m}
                </span>
              ))}
              {availableQuery.data.length > 12 && (
                <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/20 px-2 py-0.5 text-[11px] text-muted-foreground">
                  +{availableQuery.data.length - 12} more
                </span>
              )}
            </div>
          </div>
        )}
        {availableQuery.isError && (
          <p className="text-[12px] text-amber-700">
            Could not reach the model server — check that {String(profile.provider)} is running at{" "}
            {profile.baseUrl ?? "the configured host"}.
          </p>
        )}
        {availableQuery.isLoading && (
          <div className="flex gap-1.5">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6 w-20 rounded-full" />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function ModelsPage() {
  const queryClient = useQueryClient()
  const profilesQuery = useQuery({
    queryKey: queryKeys.modelProfiles,
    queryFn: ({ signal }) => getModelProfiles(signal),
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => setDefaultModelProfile(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.modelProfiles })
      toast.success("Default model profile updated.")
    },
    onError: (e: Error) => toast.error(e.message || "Could not update default profile."),
  })

  const profiles = profilesQuery.data ?? []

  return (
    <div className="space-y-6 pb-6">
      <DashboardPageIntro
        title="Models"
        subtitle="AI model profiles · Ollama · local inference"
        description="Model profiles connect Arciin's AI features to a running inference server. The default profile is used by AI Chat and all AI-assisted actions."
        stats={[
          {
            label: "Profiles",
            value: profilesQuery.isLoading ? "…" : profiles.length.toLocaleString(),
          },
          {
            label: "Default",
            value: profilesQuery.isLoading
              ? "…"
              : (profiles.find((p) => p.isDefault)?.displayName ?? "None"),
          },
        ]}
      />

      {profilesQuery.isLoading && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      )}

      {profilesQuery.isError && (
        <div className="rounded-xl border border-red-500/25 bg-red-50 px-4 py-3 text-sm text-red-800">
          {profilesQuery.error instanceof Error
            ? profilesQuery.error.message
            : "Could not load model profiles."}
        </div>
      )}

      {!profilesQuery.isLoading && profiles.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <BrainCircuit className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">No model profiles yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Configure a profile in{" "}
            <a href="/settings" className="text-primary hover:underline">
              Settings → AI
            </a>{" "}
            to connect an Ollama or compatible inference server.
          </p>
        </div>
      )}

      {profiles.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {profiles.map((p) => (
            <ModelProfileCard
              key={p.id}
              profile={p}
              onSetDefault={(id) => setDefaultMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-primary" />
            <CardTitle className="text-sm text-foreground">Running Ollama locally</CardTitle>
          </div>
          <CardDescription className="text-[13px]">
            Arciin uses Ollama for local AI inference. Pull models and configure the profile to point at{" "}
            <code className="rounded bg-muted px-1 font-mono text-[11px]">http://127.0.0.1:11434</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" size="sm" className="border-border">
            <a href="https://ollama.com" target="_blank" rel="noopener noreferrer">
              Ollama docs
              <ExternalLink className="ml-2 size-3.5 opacity-70" />
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
