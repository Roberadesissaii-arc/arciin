"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { BookOpen, Check, Copy, FolderTree, Terminal } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ConnectorStatus } from "@/lib/api/integrations"
import {
  buildPlexDockerCompose,
  DEFAULT_PLEX_INSTALL_DIR,
  PLEX_LIBRARY_MAPPING,
  resolvePlexHostPaths,
} from "@/lib/integrations/plex-install-compose"
import { cn } from "@/lib/utils"

const PLEX_CLAIM_URL = "https://www.plex.tv/claim/"
const PLEX_DOWNLOAD_URL = "https://www.plex.tv/media-server-downloads/"

type InstallTrack = "docker" | "manual"

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  } catch {
    toast.error("Could not copy to clipboard")
  }
}

export function PlexInstallPlaybook({
  status,
  pathsLoading,
}: {
  status: ConnectorStatus | undefined
  pathsLoading?: boolean
}) {
  const [track, setTrack] = useState<InstallTrack>("docker")
  const [copied, setCopied] = useState(false)

  const hostPaths = useMemo(() => resolvePlexHostPaths(status), [status])
  const compose = useMemo(
    () =>
      buildPlexDockerCompose({
        installDir: DEFAULT_PLEX_INSTALL_DIR,
        paths: hostPaths,
      }),
    [hostPaths],
  )

  const hasLivePaths = Boolean(hostPaths.videos || hostPaths.images || hostPaths.music)

  const manualSteps = [
    "Install Plex Media Server on the host that can read your Arciin storage (package, installer, or Docker).",
    "In Arciin → Integrations, turn on Use Plex folders and run Repair folders if needed.",
    "In Plex → Settings → Manage → Libraries, add libraries that point at the host paths below (read-only is fine).",
    "Upload or move media in Arciin; run Scan Library Files in Plex if items do not appear within a minute.",
  ]

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base text-foreground">Install Plex on your server</CardTitle>
            <CardDescription className="text-zinc-600">
              Arciin does not install Plex for you. Use Docker under{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{DEFAULT_PLEX_INSTALL_DIR}</code>{" "}
              (recommended) or install manually, then map Plex libraries to the Plex folders Arciin writes on disk.
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0 border-border">
            <Link href="/docs#plex-media-server">
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
        <div className="rounded-xl border border-border bg-muted/25 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">Suggested layout on Linux</p>
          <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-zinc-700">
{`/srv/
  arciin/                 ← Arciin data (ARCIIN_DATA_DIR)
    libraries/
      videos/plex/        ← Movies in Plex
      images/plex/        ← Photos in Plex
      music/plex/         ← Music in Plex
  plex/
    docker-compose.yml    ← Plex stack (this guide)
    config/               ← Plex database & settings`}
          </pre>
        </div>

        {track === "docker" ? (
          <>
            <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-zinc-700">
              <li>
                On the server:{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">
                  sudo mkdir -p {DEFAULT_PLEX_INSTALL_DIR}/config
                </code>
              </li>
              <li>
                Get a claim token from{" "}
                <a
                  href={PLEX_CLAIM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  plex.tv/claim
                </a>{" "}
                (valid ~4 minutes) and replace{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">PLEX_CLAIM</code> below.
              </li>
              <li>
                Save as{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">
                  {DEFAULT_PLEX_INSTALL_DIR}/docker-compose.yml
                </code>
                , set <code className="rounded bg-muted px-1 font-mono text-[11px]">PUID</code> /{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">PGID</code> to your Linux user, then{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">docker compose up -d</code>.
              </li>
              <li>Enable Use Plex folders in the Plex card above before uploading.</li>
            </ol>

            {pathsLoading ? (
              <p className="text-xs text-muted-foreground">Loading paths for this instance…</p>
            ) : !hasLivePaths ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                Paths below are placeholders. Turn on Plex folders or finish setup so Arciin can report your real{" "}
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
              <a href={PLEX_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">
                Download Plex Media Server
              </a>
            </Button>
          </>
        )}

        <div className="overflow-hidden rounded-xl border border-border">
          <p className="border-b border-border bg-muted/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Plex library mapping
          </p>
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-border text-zinc-500">
                <th className="px-3 py-2 font-medium">Plex library</th>
                <th className="px-3 py-2 font-medium">Container</th>
                <th className="px-3 py-2 font-medium">Arciin path (host)</th>
              </tr>
            </thead>
            <tbody>
              {PLEX_LIBRARY_MAPPING.map((row) => {
                const hostPath = hostPaths[row.slug]
                return (
                  <tr key={row.slug} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5 font-medium text-foreground">{row.plexType}</td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-zinc-600">{row.containerPath}</td>
                    <td className="px-3 py-2.5">
                      <span className="block font-mono text-[11px] break-all text-zinc-700">
                        {pathsLoading
                          ? "…"
                          : hostPath ?? (
                              <span className="text-zinc-400">
                                {row.arciinLibrary} → {row.arciinFolder} (enable Plex folders)
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

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          TV shows: add another Plex library pointing at a folder under Videos if you split TV from movies. Arciin
          mirrors uploads into <span className="font-medium">Videos → Plex</span> by default; organize inside Plex or
          add subfolders on disk as you prefer.
        </p>
      </CardContent>
    </Card>
  )
}
