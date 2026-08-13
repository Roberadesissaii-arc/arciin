import { DemoBanner } from "@/components/demo-banner"
import { CopyButton } from "@/components/copy-button"
import { Card, PageHeader, StatTile } from "@/components/ui"
import {
  APP_VERSION,
  DOCKER_INSTALL_HINT,
  INSTALL_COMMAND,
  RELEASE_CHANNEL,
} from "@/lib/demo-customer"

export default function DownloadsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Install"
        title="Downloads"
        description="Install Arciin on your server without cloning the monorepo. Private images and the public install script ship later."
      />

      <DemoBanner />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Latest version" value={APP_VERSION} hint="Placeholder build id" />
        <StatTile label="Release channel" value={RELEASE_CHANNEL} hint="stable · beta later" />
        <StatTile label="Distribution" value="Docker" hint="Private images prototype" />
      </div>

      <Card>
        <h2 className="font-display text-[17px] font-semibold text-[var(--text)]">
          One-line install
        </h2>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Future public installer. For now this command is a placeholder for get.arciin.com.
        </p>
        <div className="code-block mt-4 flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all text-[12px] text-[var(--text)]">
            {INSTALL_COMMAND}
          </code>
          <CopyButton value={INSTALL_COMMAND} label="Copy command" className="shrink-0" />
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-[17px] font-semibold text-[var(--text)]">
          Docker Compose install
        </h2>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Private distribution: customer receives compose + env + images — not source.
        </p>
        <pre className="code-block mt-4 overflow-x-auto p-4 leading-relaxed text-[12px] text-[var(--text)]">
          {DOCKER_INSTALL_HINT}
        </pre>
        <div className="mt-3">
          <CopyButton value={DOCKER_INSTALL_HINT} label="Copy Docker steps" />
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-[17px] font-semibold text-[var(--text)]">
          System requirements
        </h2>
        <ul className="mt-4 space-y-2">
          {[
            ["OS", "64-bit Linux (Ubuntu/Debian recommended)"],
            ["Runtime", "Docker Engine + Compose v2"],
            ["RAM", "2 GB min · 4 GB+ recommended for media"],
            ["Storage", "SSD/HDD for libraries — bind-mounted outside containers"],
            ["Network", "Port 80 free for Caddy (or configure HTTP port)"],
          ].map(([label, value]) => (
            <li
              key={label}
              className="flex flex-col gap-0.5 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-2.5 sm:flex-row sm:items-center sm:gap-4"
            >
              <span className="min-w-[5rem] text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                {label}
              </span>
              <span className="text-[13px] text-[var(--text)] sm:flex-1">{value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[13px]">
          <a
            href="https://docs.arciin.com"
            className="font-semibold text-[var(--accent)] underline-offset-2 hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            Open documentation
          </a>
          <span className="text-[var(--text-muted)]"> · full guides on the product docs site.</span>
        </p>
      </Card>
    </>
  )
}
