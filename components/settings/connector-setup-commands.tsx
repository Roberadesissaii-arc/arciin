"use client"

import type { ConnectorStatus } from "@/lib/api/integrations"
import { CopyableShellBlock } from "@/components/settings/copyable-shell-block"
import {
  buildMediaServerSetupCommands,
  buildStorageLayoutTree,
  CONNECTOR_HOW_IT_WORKS,
  type MediaStackKind,
} from "@/lib/integrations/setup-shell-commands"
import { cn } from "@/lib/utils"

export function ConnectorSetupCommands({
  kind,
  status,
  pathsLoading,
  installDir,
  className,
}: {
  kind: MediaStackKind
  status: ConnectorStatus | undefined
  pathsLoading?: boolean
  installDir: string
  className?: string
}) {
  const setup = buildMediaServerSetupCommands(status, kind, installDir)
  const layoutTree = buildStorageLayoutTree(status, kind, installDir)
  const howItWorks = CONNECTOR_HOW_IT_WORKS[kind]

  return (
    <div className={cn("space-y-4", className)}>
      <div className="rounded-xl border border-border bg-muted/20 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        <p className="font-semibold text-foreground">How the connection works</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4">
          {howItWorks.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-border bg-muted/25 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        <p className="font-medium text-foreground">Paths on this instance</p>
        {pathsLoading ? (
          <p className="mt-2 text-xs">Loading storage root from the API…</p>
        ) : (
          <>
            {setup.storageRoot ? (
              <p className="mt-2">
                <span className="font-medium text-foreground">Storage root: </span>
                <span className="break-all font-mono text-[11px] text-zinc-700">{setup.storageRoot}</span>
              </p>
            ) : null}
            <pre className="mt-2 overflow-x-auto font-mono text-[11px] text-zinc-700">{layoutTree}</pre>
            {!setup.mediaPaths.videos && !pathsLoading ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-900">
                Turn on <strong>Use {kind === "plex" ? "Plex" : "Jellyfin"} folders</strong> in the card above so
                Arciin registers folders and reports real paths (under your storage root, not a generic /srv example).
              </p>
            ) : null}
          </>
        )}
      </div>

      <CopyableShellBlock
        title="Setup commands (copy & paste)"
        description="Run on the Linux host where Arciin stores files. Arciin creates these folders when you enable connector folders and on upload; this script is optional prep."
        script={setup.script}
        copyLabel="Copy setup script"
      />
    </div>
  )
}
