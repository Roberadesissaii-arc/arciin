"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { ConnectorSetupCommands } from "@/components/settings/connector-setup-commands"
import { CopyableShellBlock } from "@/components/settings/copyable-shell-block"
import { getPlexStatus } from "@/lib/api/integrations"
import { queryKeys } from "@/lib/api/query-keys"
import {
  buildPlexDockerCompose,
  DEFAULT_PLEX_INSTALL_DIR,
  resolvePlexHostPaths,
} from "@/lib/integrations/plex-install-compose"

function DocP({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-zinc-600">{children}</p>
}

function IC({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[12px] text-zinc-800">{children}</code>
}

export function PlexMediaServerDocs() {
  const statusQuery = useQuery({
    queryKey: queryKeys.plexStatus,
    queryFn: ({ signal }) => getPlexStatus(signal),
  })
  const status = statusQuery.data
  const hostPaths = resolvePlexHostPaths(status)
  const compose = buildPlexDockerCompose({
    installDir: DEFAULT_PLEX_INSTALL_DIR,
    paths: hostPaths,
  })

  return (
    <div className="space-y-5">
      <DocP>
        Arciin does <strong className="text-zinc-900">not</strong> install Plex. You run Plex on the same host (or any
        host that can read your storage), then map Plex libraries to the <IC>Videos → Plex</IC>, <IC>Images → Plex</IC>,
        and <IC>Music → Plex</IC> folders Arciin mirrors on disk. There is no Plex API link inside Arciin — only shared
        folders.
      </DocP>

      <DocP>
        <strong className="text-zinc-900">Order of operations:</strong> On{" "}
        <Link href="/integrations" className="font-medium text-primary underline-offset-4 hover:underline">Integrations</Link>, turn on{" "}
        <strong className="text-zinc-900">Use Plex folders</strong> first — Arciin creates{" "}
        <IC>libraries/videos|images|music/plex</IC> under your storage root (see{" "}
        <Link href="/settings/storage" className="font-medium text-primary underline-offset-4 hover:underline">
          Settings → Storage
        </Link>
        ). You do <strong className="text-zinc-900">not</strong> need a separate step to mkdir those folders on disk.
      </DocP>

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        <p className="font-medium text-zinc-900">Where files live on the host</p>
        <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-800">{`${DEFAULT_PLEX_INSTALL_DIR}/
  docker-compose.yml   ← copy setup script writes this file here
  config/              ← Plex database (empty until container runs)

<your storage root>/libraries/…/plex/   ← Arciin media (Integrations creates these)`}</pre>
      </div>

      <ConnectorSetupCommands
        kind="plex"
        status={status}
        pathsLoading={statusQuery.isLoading}
        installDir={DEFAULT_PLEX_INSTALL_DIR}
      />

      <DocP>
        After the setup script runs: get a claim token (~4 minutes) from{" "}
        <a
          href="https://www.plex.tv/claim/"
          className="font-medium text-primary underline-offset-4 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          plex.tv/claim
        </a>
        , run <IC>nano {DEFAULT_PLEX_INSTALL_DIR}/docker-compose.yml</IC> to set <IC>PLEX_CLAIM</IC>,{" "}
        <IC>PUID</IC>, and <IC>PGID</IC>, then <IC>cd {DEFAULT_PLEX_INSTALL_DIR} && docker compose up -d</IC>.
      </DocP>

      <CopyableShellBlock
        title={`${DEFAULT_PLEX_INSTALL_DIR}/docker-compose.yml`}
        description="Same file the setup script writes. Use this block if you already ran setup and only need to refresh volume paths."
        script={compose}
        copyLabel="Copy docker-compose.yml"
      />

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        <p className="font-medium text-zinc-900">Plex library types</p>
        <p className="mt-1.5 leading-relaxed">
          Map <strong className="text-zinc-900">Movies</strong> → container <IC>/movies</IC>,{" "}
          <strong className="text-zinc-900">Photos</strong> → <IC>/photos</IC>, <strong className="text-zinc-900">Music</strong> →{" "}
          <IC>/music</IC>. Host paths must match the <IC>libraries/…/plex</IC> directories Arciin uses on disk.
        </p>
      </div>
    </div>
  )
}
