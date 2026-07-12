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
import { cn } from "@/lib/utils"

function DocH2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-28 flex items-center gap-3 font-heading text-[1.55rem] font-semibold tracking-tight text-zinc-900"
    >
      <span className="h-6 w-1 shrink-0 rounded-full bg-primary/70" aria-hidden />
      {children}
    </h2>
  )
}

function DocP({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[15px] leading-7 text-zinc-700", className)}>{children}</p>
}

function IC({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-zinc-200/80 px-1.5 py-0.5 font-mono text-[12px] text-zinc-900">
      {children}
    </code>
  )
}

function Callout({
  variant,
  title,
  children,
}: {
  variant: "tip" | "warning" | "success"
  title: string
  children: React.ReactNode
}) {
  const cls =
    variant === "warning"
      ? "border-l-amber-500 bg-amber-50"
      : variant === "success"
        ? "border-l-emerald-500 bg-emerald-50"
        : "border-l-primary bg-primary/[0.06]"
  return (
    <aside
      className={`rounded-xl border border-zinc-200/80 border-l-4 px-4 py-3 text-sm leading-relaxed shadow-sm ${cls}`}
    >
      <p className="font-semibold text-zinc-900">{title}</p>
      <div className="mt-1.5 text-zinc-700 [&>p+p]:mt-2">{children}</div>
    </aside>
  )
}

function Sep() {
  return <div className="h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent" />
}

export function IntegrationsDocs() {
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
    <div className="space-y-12">
      <section className="space-y-5">
        <DocH2 id="integrations-overview">How connectors work</DocH2>
        <DocP>
          Arciin connectors (Plex, Jellyfin) are <strong className="text-zinc-900">folder-based</strong>, not a live Plex
          API link. When you enable a connector on{" "}
          <Link href="/integrations" className="font-medium text-primary underline-offset-4 hover:underline">
            Integrations
          </Link>
          , Arciin creates <IC>Videos/Plex</IC>, <IC>Images/Plex</IC>, and <IC>Music/Plex</IC> folders (or Jellyfin
          equivalents), routes new uploads there, and <strong className="text-zinc-900">mirrors files on disk</strong>{" "}
          under <IC>libraries/&lt;slug&gt;/plex</IC> inside your storage root.
        </DocP>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white text-[13px] shadow-sm">
          <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
            Upload → Plex sees a file
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-zinc-600">{`You upload a video in Arciin
  ↓
Asset stored under storage/objects/…
  ↓
Metadata in PostgreSQL (library, folder, filename)
  ↓
Connector mirror copies (or hard-links) into:
  <storage>/libraries/videos/plex/my-movie.mp4
  ↓
Plex library points at that folder on disk
  ↓
You scan the library in Plex → video appears`}</pre>
        </div>
        <Callout variant="tip" title="What API keys, webhooks, and Socket.IO do">
          <p>
            They tell <em>your</em> scripts and apps that Arciin finished an upload (<IC>upload.completed</IC>,{" "}
            <IC>asset.created</IC>). They do <strong className="text-zinc-900">not</strong> push bytes into a remote Plex
            server. Plex only sees new files when it can read the same folder path on disk (same host or a shared mount).
          </p>
        </Callout>
        <DocP>
          Full REST examples for uploads and keys live in{" "}
          <a href="#uploads" className="font-medium text-primary underline-offset-4 hover:underline">
            File uploads
          </a>{" "}
          and{" "}
          <a href="#api-keys" className="font-medium text-primary underline-offset-4 hover:underline">
            API keys
          </a>
          .
        </DocP>
      </section>

      <Sep />

      <section className="space-y-5">
        <DocH2 id="plex-same-server">Plex on the same server</DocH2>
        <DocP>
          Best case: Arciin and Plex run on one machine and Plex Docker mounts the <strong className="text-zinc-900">same</strong>{" "}
          storage root Arciin uses. No API keys or webhooks are required for Plex to see files — only shared folders.
        </DocP>
        <DocP>
          <strong className="text-zinc-900">Order of operations:</strong> On{" "}
          <Link href="/integrations" className="font-medium text-primary underline-offset-4 hover:underline">
            Integrations
          </Link>
          , turn on <strong className="text-zinc-900">Use Plex folders</strong> first. Arciin creates{" "}
          <IC>libraries/videos|images|music/plex</IC> under your storage root (see{" "}
          <Link href="/settings/storage" className="font-medium text-primary underline-offset-4 hover:underline">
            Settings → Storage
          </Link>
          ). Then install Plex and map libraries to those paths.
        </DocP>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          <p className="font-medium text-zinc-900">Where files live on the host</p>
          <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-zinc-800">{`${DEFAULT_PLEX_INSTALL_DIR}/
  docker-compose.yml   ← setup script writes this here
  config/              ← Plex database

<your storage root>/libraries/…/plex/   ← Arciin mirrors uploads here`}</pre>
        </div>
        <ConnectorSetupCommands
          kind="plex"
          status={status}
          pathsLoading={statusQuery.isLoading}
          installDir={DEFAULT_PLEX_INSTALL_DIR}
        />
        <DocP>
          After the setup script runs: claim token from{" "}
          <a
            href="https://www.plex.tv/claim/"
            className="font-medium text-primary underline-offset-4 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            plex.tv/claim
          </a>
          , edit <IC>{DEFAULT_PLEX_INSTALL_DIR}/docker-compose.yml</IC> (<IC>PLEX_CLAIM</IC>, <IC>PUID</IC>,{" "}
          <IC>PGID</IC>), then <IC>cd {DEFAULT_PLEX_INSTALL_DIR} && docker compose up -d</IC>.
        </DocP>
        <CopyableShellBlock
          title={`${DEFAULT_PLEX_INSTALL_DIR}/docker-compose.yml`}
          description="Same file the setup script writes. Refresh volume paths if your storage root changed."
          script={compose}
          copyLabel="Copy docker-compose.yml"
        />
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
          <p className="font-medium text-zinc-900">Plex library mapping</p>
          <p className="mt-1.5 leading-relaxed">
            <strong className="text-zinc-900">Movies</strong> → container <IC>/movies</IC> (host:{" "}
            <IC>…/libraries/videos/plex</IC>), <strong className="text-zinc-900">Photos</strong> → <IC>/photos</IC>,{" "}
            <strong className="text-zinc-900">Music</strong> → <IC>/music</IC>. Host paths must match the mirror paths
            Arciin shows on the Plex integration card.
          </p>
        </div>
      </section>

      <Sep />

      <section className="space-y-5">
        <DocH2 id="plex-remote-server">Plex on a different server</DocH2>
        <DocP>
          Arciin does <strong className="text-zinc-900">not</strong> stream files to a remote Plex box over the network.
          The remote Plex server must read the <strong className="text-zinc-900">same folder tree</strong> Arciin writes —
          usually by mounting Arciin&apos;s storage on the Plex host.
        </DocP>
        <Callout variant="warning" title="API keys and webhooks are not a Plex transport">
          <p>
            An API key lets a script <em>talk to Arciin</em> (upload, list assets). A webhook fires when Arciin finishes
            an upload. Neither copies the file to another machine. For split hosts, use NFS, SMB, or sync — then point
            Plex libraries at the mount.
          </p>
        </Callout>
        <div className="space-y-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-[13px] font-semibold text-zinc-900">Option A — NFS (Linux → Linux)</p>
            <DocP className="mt-2 text-sm">
              Export <IC>/srv/arciin-storage/arciin/libraries</IC> from the Arciin host. On the Plex server, mount it
              (e.g. <IC>/mnt/arciin-libraries</IC>) and add Plex libraries that point at{" "}
              <IC>/mnt/arciin-libraries/videos/plex</IC>, etc.
            </DocP>
            <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-100">{`# Arciin host (/etc/exports)
/srv/arciin-storage/arciin/libraries  192.168.1.50(rw,sync,no_subtree_check)

# Plex host
sudo mount 192.168.1.10:/srv/arciin-storage/arciin/libraries /mnt/arciin-libraries`}</pre>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-[13px] font-semibold text-zinc-900">Option B — SMB (Windows / NAS)</p>
            <DocP className="mt-2 text-sm">
              Share the Arciin <IC>libraries</IC> folder on the network. Map the share on the Plex machine and use those
              paths when creating Plex libraries.
            </DocP>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-[13px] font-semibold text-zinc-900">Option C — Replication (advanced)</p>
            <DocP className="mt-2 text-sm">
              Use <IC>rsync</IC>, Syncthing, or similar to replicate <IC>libraries/…/plex</IC> to the Plex host. Run on a
              schedule or trigger from a webhook handler that starts a sync job — Arciin does not ship this job yet.
            </DocP>
          </div>
        </div>
        <DocP>
          After the Plex server can read the mirrored paths, new Arciin uploads appear as files on disk immediately; Plex
          still needs a library scan (see next section).
        </DocP>
      </section>

      <Sep />

      <section className="space-y-5">
        <DocH2 id="plex-library-scan">Refresh Plex libraries</DocH2>
        <DocP>
          Arciin copies files into Plex folders but <strong className="text-zinc-900">does not call the Plex API</strong>{" "}
          to refresh metadata. After uploads, tell Plex to scan:
        </DocP>
        <ol className="list-decimal space-y-2 pl-5 text-[15px] leading-7 text-zinc-700">
          <li>Open Plex → your library → <strong className="text-zinc-900">⋯</strong> → <strong className="text-zinc-900">Scan Library Files</strong>.</li>
          <li>
            Or enable <strong className="text-zinc-900">Settings → Library → Scan my library automatically</strong> on the
            Plex server (periodic scan).
          </li>
        </ol>
        <Callout variant="success" title="Same-server tip">
          <p>
            If Plex and Arciin share one storage root, uploads land in the folder Plex already watches — you only need
            scans when Plex does not auto-detect new files.
          </p>
        </Callout>
      </section>

      <Sep />

      <section className="space-y-5">
        <DocH2 id="jellyfin-connector">Jellyfin</DocH2>
        <DocP>
          Jellyfin uses the <strong className="text-zinc-900">same connector model</strong> as Plex: enable{" "}
          <strong className="text-zinc-900">Use Jellyfin folders</strong> on{" "}
          <Link href="/integrations" className="font-medium text-primary underline-offset-4 hover:underline">
            Integrations
          </Link>
          , mirror into <IC>libraries/…/jellyfin</IC>, then point Jellyfin libraries at those paths on disk.
        </DocP>
        <DocP>
          Same-server: mount the Arciin storage root in Jellyfin Docker. Remote server: NFS/SMB mount the{" "}
          <IC>libraries</IC> tree on the Jellyfin host — identical to Plex remote setup.
        </DocP>
        <DocP>
          Jellyfin setup commands and compose snippets are on the Jellyfin card under Integrations (same pattern as Plex).
        </DocP>
      </section>

      <Sep />

      <section className="space-y-5">
        <DocH2 id="connector-automation">Webhooks, Socket.IO &amp; API keys</DocH2>
        <DocP>
          Use these when <em>another app</em> should react to Arciin uploads — not when Plex needs the file bytes.
        </DocP>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
                <th className="px-4 py-2 font-semibold">Tool</th>
                <th className="px-4 py-2 font-semibold">Use for connectors</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 text-zinc-700">
              <tr>
                <td className="px-4 py-2.5 font-medium">API key</td>
                <td className="px-4 py-2.5">
                  Upload from a script (<IC>uploads:create</IC>), list assets, check folder paths. Does not notify Plex.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-medium">Webhook</td>
                <td className="px-4 py-2.5">
                  Your server receives <IC>upload.completed</IC> → run rsync, send a push notification, or log. Plex scan
                  is still manual unless you automate it yourself.
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-medium">Socket.IO</td>
                <td className="px-4 py-2.5">
                  Live dashboard updates in Arciin; scripts can subscribe with <IC>events:subscribe</IC>. Same events as
                  webhooks.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <DocP>
          See{" "}
          <a href="#webhooks" className="font-medium text-primary underline-offset-4 hover:underline">
            Webhooks
          </a>
          ,{" "}
          <a href="#realtime" className="font-medium text-primary underline-offset-4 hover:underline">
            Socket.IO
          </a>
          , and{" "}
          <a href="#events" className="font-medium text-primary underline-offset-4 hover:underline">
            Event catalogue
          </a>{" "}
          for payloads. Configure webhook endpoints under{" "}
          <Link href="/developer/webhooks" className="font-medium text-primary underline-offset-4 hover:underline">
            Developer → Webhooks
          </Link>
          .
        </DocP>
      </section>
    </div>
  )
}
