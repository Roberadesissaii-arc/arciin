"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { BookOpen, Check, Copy, FolderTree, Terminal } from "lucide-react"
import { toast } from "sonner"

import { ConnectorSetupCommands } from "@/components/settings/connector-setup-commands"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ConnectorStatus } from "@/lib/api/integrations"
import {
  buildJellyfinDockerCompose,
  DEFAULT_JELLYFIN_INSTALL_DIR,
  JELLYFIN_LIBRARY_MAPPING,
  resolveJellyfinHostPaths,
} from "@/lib/integrations/jellyfin-install-compose"
import { cn } from "@/lib/utils"

const JELLYFIN_DOWNLOAD_URL = "https://jellyfin.org/downloads/"

type InstallTrack = "docker" | "manual"

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  } catch {
    toast.error("Could not copy to clipboard")
  }
}

export function JellyfinInstallPlaybook({
  status,
  pathsLoading,
}: {
  status: ConnectorStatus | undefined
  pathsLoading?: boolean
}) {
  const [track, setTrack] = useState<InstallTrack>("docker")
  const [copied, setCopied] = useState(false)

  const hostPaths = useMemo(() => resolveJellyfinHostPaths(status), [status])
  const compose = useMemo(
    () =>
      buildJellyfinDockerCompose({
        installDir: DEFAULT_JELLYFIN_INSTALL_DIR,
        paths: hostPaths,
      }),
    [hostPaths],
  )

  const hasLivePaths = Boolean(hostPaths.videos || hostPaths.images || hostPaths.music)

  const manualSteps = [
    "Install Jellyfin Server on a host that can read your Arciin storage (package, installer, or Docker).",
    "In Arciin → Integrations, turn on Use Jellyfin folders and run Repair folders if needed.",
    "In Jellyfin Dashboard → Libraries, add folders that match the host paths below.",
    "Upload in Arciin; scan or refresh libraries in Jellyfin if items do not appear.",
  ]

  return (
    <Card className="flex h-full min-h-0 flex-col border-border bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base text-foreground">Install Jellyfin on your server</CardTitle>
            <CardDescription className="text-zinc-600">
              Arciin does not install Jellyfin for you. Use Docker under{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                {DEFAULT_JELLYFIN_INSTALL_DIR}
              </code>{" "}
              (recommended) or install manually, then map Jellyfin libraries to the Jellyfin folders Arciin writes on
              disk.
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0 border-border">
            <Link href="/docs">
              <BookOpen className="size-3.5" />
              Docs
            </Link>
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {(
            [
              { id: "docker" as const, label: "Docker Compose", icon: Terminal },
              { id: "manual" as const, label: "Manual install", icon: FolderTree },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTrack(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors",
                track === id
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-white text-zinc-600 hover:border-zinc-300",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <ConnectorSetupCommands
          kind="jellyfin"
          status={status}
          pathsLoading={pathsLoading}
          installDir={DEFAULT_JELLYFIN_INSTALL_DIR}
        />

        {track === "docker" ? (
          <>
            <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-zinc-700">
              <li>
                In Arciin → Integrations, turn on <strong>Use Jellyfin folders</strong> (creates{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">libraries/…/jellyfin</code> on disk).
              </li>
              <li>
                Run the <strong>setup commands</strong> above on the host (paths match this instance&apos;s storage
                root).
              </li>
              <li>
                Save as{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">
                  {DEFAULT_JELLYFIN_INSTALL_DIR}/docker-compose.yml
                </code>
                , set <code className="rounded bg-muted px-1 font-mono text-[11px]">PUID</code> /{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">PGID</code>, then{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">docker compose up -d</code>.
              </li>
              <li>
                Open <code className="rounded bg-muted px-1 font-mono text-[11px]">http://YOUR_HOST:8096</code> and
                complete the first-run wizard.
              </li>
              <li>Upload in Arciin, then scan libraries in Jellyfin if needed.</li>
            </ol>

            {pathsLoading ? (
              <p className="text-xs text-muted-foreground">Loading paths for this instance…</p>
            ) : !hasLivePaths ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                Paths below are placeholders. Turn on Jellyfin folders or finish setup so Arciin can report your real{" "}
                <code className="font-mono">libraries/</code> directory.
              </p>
            ) : (
              <p className="text-[12px] text-emerald-800">
                Volume lines use this instance&apos;s Arciin library paths.
              </p>
            )}

            <div className="relative rounded-xl border border-zinc-800 bg-zinc-950">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="absolute top-2 right-2 z-10 h-8 gap-1.5 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
                onClick={async () => {
                  await copyText(compose, "docker-compose.yml")
                  setCopied(true)
                  window.setTimeout(() => setCopied(false), 2000)
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy compose"}
              </Button>
              <pre className="max-h-[420px] overflow-auto p-4 pt-12 text-[11px] leading-relaxed text-zinc-100">
                <code>{compose}</code>
              </pre>
            </div>
          </>
        ) : (
          <>
            <ol className="space-y-3">
              {manualSteps.map((body, i) => (
                <li key={body} className="flex gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <p className="text-[13px] leading-relaxed text-zinc-700">{body}</p>
                </li>
              ))}
            </ol>
            <Button asChild className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              <a href={JELLYFIN_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                Download Jellyfin
              </a>
            </Button>
          </>
        )}

        <div className="overflow-hidden rounded-xl border border-border">
          <p className="border-b border-border bg-muted/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Jellyfin library mapping
          </p>
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-border text-zinc-500">
                <th className="px-3 py-2 font-medium">Jellyfin library</th>
                <th className="px-3 py-2 font-medium">Container</th>
                <th className="px-3 py-2 font-medium">Arciin path (host)</th>
              </tr>
            </thead>
            <tbody>
              {JELLYFIN_LIBRARY_MAPPING.map((row) => {
                const hostPath = hostPaths[row.slug]
                return (
                  <tr key={row.slug} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5 font-medium text-foreground">{row.jellyfinType}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-600">{row.containerPath}</td>
                    <td className="px-3 py-2.5">
                      <span className="block font-mono text-[11px] break-all text-zinc-700">
                        {pathsLoading
                          ? "…"
                          : hostPath ?? (
                              <span className="text-zinc-400">
                                {row.arciinLibrary} → {row.arciinFolder} (enable Jellyfin folders)
                              </span>
                            )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
