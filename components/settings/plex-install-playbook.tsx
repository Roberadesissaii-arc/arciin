"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { BookOpen, Check, ChevronDown, ChevronUp, Copy, ExternalLink, FolderTree, KeyRound, Terminal } from "lucide-react"

import { ConnectorSetupCommands } from "@/components/settings/connector-setup-commands"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ConnectorStatus } from "@/lib/api/integrations"
import {
  buildPlexDockerCompose,
  DEFAULT_PLEX_INSTALL_DIR,
  PLEX_LIBRARY_MAPPING,
  resolvePlexHostPaths,
} from "@/lib/integrations/plex-install-compose"
import { copyToClipboard } from "@/lib/utils/clipboard"
import { cn } from "@/lib/utils"

const PLEX_CLAIM_URL = "https://www.plex.tv/claim/"
const PLEX_DOWNLOAD_URL = "https://www.plex.tv/media-server-downloads/"

type InstallTrack = "docker" | "manual"

function CollapsibleCompose({
  compose,
  copied,
  onCopy,
}: {
  compose: string
  copied: boolean
  onCopy: () => void
}) {
  const lineCount = compose.split("\n").length
  const [expanded, setExpanded] = useState(true)
  const visible = expanded ? compose : compose.split("\n").slice(0, 10).join("\n") + "\n…"

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">docker-compose.yml</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-8 gap-1.5 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
          onClick={onCopy}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy compose"}
        </Button>
      </div>
      <pre className="p-4 text-[11px] leading-relaxed text-zinc-100">
        <code>{visible}</code>
      </pre>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-zinc-800 py-2 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
      >
        {expanded ? (
          <><ChevronUp className="size-3.5" /> Collapse</>
        ) : (
          <><ChevronDown className="size-3.5" /> Show all {lineCount} lines</>
        )}
      </button>
    </div>
  )
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
  const [claimToken, setClaimToken] = useState("")

  const hostPaths = useMemo(() => resolvePlexHostPaths(status), [status])
  const compose = useMemo(
    () =>
      buildPlexDockerCompose({
        installDir: DEFAULT_PLEX_INSTALL_DIR,
        paths: hostPaths,
        claimToken: claimToken.trim() || undefined,
      }),
    [hostPaths, claimToken],
  )

  const hasLivePaths = Boolean(hostPaths.videos || hostPaths.images || hostPaths.music)

  const manualSteps = [
    "Install Plex Media Server on the host that can read your Arciin storage (package, installer, or Docker).",
    "In Arciin → Integrations, turn on Use Plex folders and run Repair folders if needed.",
    "In Plex → Settings → Manage → Libraries, add libraries that point at the host paths below (read-only is fine).",
    "Upload or move media in Arciin; run Scan Library Files in Plex if items do not appear within a minute.",
  ]

  return (
    <Card className="flex h-full min-h-0 flex-col border-border bg-card shadow-sm">
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
        <ConnectorSetupCommands
          kind="plex"
          status={status}
          pathsLoading={pathsLoading}
          installDir={DEFAULT_PLEX_INSTALL_DIR}
        />

        {track === "docker" ? (
          <>
            <ol className="list-decimal space-y-2 pl-5 text-[13px] leading-relaxed text-zinc-700">
              <li>
                In Arciin → Integrations, turn on <strong>Use Plex folders</strong>. Arciin creates{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">libraries/…/plex</code> under your
                storage root — no manual <code className="rounded bg-muted px-1 font-mono text-[11px]">mkdir</code> for
                those paths.
              </li>
              <li>
                Copy the <strong>host setup script</strong> above into SSH. It creates{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">{DEFAULT_PLEX_INSTALL_DIR}/config/</code> and
                writes{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">
                  {DEFAULT_PLEX_INSTALL_DIR}/docker-compose.yml
                </code>{" "}
                (compose lives beside <code className="rounded bg-muted px-1 font-mono text-[11px]">config/</code>, not
                inside it).
              </li>
              <li>
                Get a claim token from{" "}
                <a
                  href={PLEX_CLAIM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
                >
                  plex.tv/claim
                  <ExternalLink className="size-3 opacity-70" />
                </a>{" "}
                (valid ~4 minutes), paste below or edit in the file on disk.
              </li>
              <li>
                <code className="rounded bg-muted px-1 font-mono text-[11px]">
                  nano {DEFAULT_PLEX_INSTALL_DIR}/docker-compose.yml
                </code>{" "}
                — set <code className="rounded bg-muted px-1 font-mono text-[11px]">PLEX_CLAIM</code>,{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">PUID</code>,{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">PGID</code>, then{" "}
                <code className="rounded bg-muted px-1 font-mono text-[11px]">
                  cd {DEFAULT_PLEX_INSTALL_DIR} && docker compose up -d
                </code>
                .
              </li>
              <li>Upload in Arciin, then scan libraries in Plex if needed.</li>
            </ol>

            {/* Plex claim token input */}
            <div className="rounded-xl border border-border bg-muted/20 p-3.5 space-y-2">
              <div className="flex items-center gap-2">
                <KeyRound className="size-3.5 shrink-0 text-primary" />
                <p className="text-[12px] font-semibold text-foreground">Plex claim token</p>
                <a
                  href={PLEX_CLAIM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  Get token at plex.tv/claim
                  <ExternalLink className="size-3 opacity-70" />
                </a>
              </div>
              <input
                type="text"
                value={claimToken}
                onChange={(e) => setClaimToken(e.target.value)}
                placeholder="claim-xxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                spellCheck={false}
                autoComplete="off"
              />
              <p className="text-[11px] text-muted-foreground">
                Token is valid for ~4 minutes after generation. The compose file below updates as you type.
              </p>
            </div>

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

            <CollapsibleCompose
              compose={compose}
              copied={copied}
              onCopy={async () => {
                await copyToClipboard(compose, "docker-compose.yml")
                setCopied(true)
                window.setTimeout(() => setCopied(false), 2000)
              }}
            />
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
