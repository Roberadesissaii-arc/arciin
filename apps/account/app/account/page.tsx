import Link from "next/link"
import {
  BookOpen,
  Download,
  KeyRound,
  Server,
  Shield,
  Terminal,
  ArrowUpRight,
} from "lucide-react"

import { DemoBanner } from "@/components/demo-banner"
import { CreateDemoButtons } from "@/components/license-actions"
import { CopyButton } from "@/components/copy-button"
import {
  Card,
  FieldLabel,
  PageHeader,
  StatTile,
  StatusPill,
  formatDateShort,
  planTitle,
} from "@/components/ui"
import { INSTALL_COMMAND } from "@/lib/demo-customer"
import { fetchAccountOverview } from "@/lib/license-api"

export const dynamic = "force-dynamic"

export default async function AccountOverviewPage() {
  let overview: Awaited<ReturnType<typeof fetchAccountOverview>> | null = null
  let error: string | null = null
  try {
    overview = await fetchAccountOverview()
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load account"
  }

  const s = overview?.summary
  const customer = overview?.customer

  return (
    <>
      <PageHeader
        eyebrow="Control plane"
        title="Account overview"
        description="Manage plans, license keys, activated servers, and installers — separate from your self-hosted Arciin instance."
      />

      <DemoBanner />

      {error ? (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm font-semibold text-amber-950">License server unreachable</p>
          <p className="mt-1 text-[13px] text-amber-900/80">{error}</p>
          <p className="mt-2 text-[12px] text-amber-900/70">
            Start it with <code className="font-mono text-amber-950">pnpm license-server</code>.
            Health: <code className="font-mono">:4100/health</code>
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Customer" value={customer?.name ?? "—"} hint={customer?.email ?? "—"} />
        <StatTile
          label="Current plan"
          value={planTitle(s?.primaryPlan ?? "none")}
          hint={`${s?.activeLicenses ?? 0} active license${(s?.activeLicenses ?? 0) === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Activated servers"
          value={String(s?.activatedServers ?? 0)}
          hint="Across all licenses"
        />
        <StatTile
          label="Renewal"
          value={formatDateShort(s?.nextRenewalAt)}
          hint="Placeholder · no billing yet"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
        <Card>
          <div className="flex items-center gap-2">
            <div className="flex size-9 items-center justify-center rounded-xl bg-[var(--accent-soft)]">
              <Shield className="size-4 text-[var(--accent)]" />
            </div>
            <h2 className="font-display text-[17px] font-semibold tracking-tight text-[var(--text)]">
              Quick actions
            </h2>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              { href: "/account/licenses", icon: KeyRound, label: "View licenses" },
              { href: "/account/downloads", icon: Download, label: "Download installer" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-3.5 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
              >
                <item.icon className="size-4 text-[var(--accent)]" />
                <span className="flex-1 text-[13px] font-medium text-[var(--text)]">
                  {item.label}
                </span>
                <ArrowUpRight className="size-3.5 text-[var(--text-faint)] group-hover:text-[var(--text-muted)]" />
              </Link>
            ))}
            <div className="code-block flex items-center gap-2 px-3 py-2.5 sm:col-span-2">
              <Terminal className="size-4 shrink-0 text-[var(--accent)]" />
              <code className="min-w-0 flex-1 truncate text-[11px] text-[var(--text)]">
                {INSTALL_COMMAND}
              </code>
              <CopyButton value={INSTALL_COMMAND} label="Copy" className="h-9 shrink-0" />
            </div>
            <a
              href="https://docs.arciin.com"
              target="_blank"
              rel="noreferrer"
              className="group flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-3.5 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)] sm:col-span-2"
            >
              <BookOpen className="size-4 text-[var(--accent)]" />
              <span className="flex-1 text-[13px] font-medium text-[var(--text)]">
                Open documentation
              </span>
              <ArrowUpRight className="size-3.5 text-[var(--text-faint)]" />
            </a>
          </div>
        </Card>

        <Card muted>
          <FieldLabel>Backup status</FieldLabel>
          <p className="font-display mt-2 text-xl font-semibold text-[var(--text)]">
            Not connected
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
            Cloud backup add-on comes later. Manual local backup stays free on every self-hosted
            install.
          </p>
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[12px] text-[var(--text-muted)]">
            <Server className="size-3.5 text-[var(--accent)]" />
            {s?.activatedServers ?? 0} server{(s?.activatedServers ?? 0) === 1 ? "" : "s"} registered
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="font-display text-[17px] font-semibold tracking-tight text-[var(--text)]">
          Issue a demo license
        </h2>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Creates a real key on the license server. Paste it into your self-hosted instance under
          Settings → License.
        </p>
        <div className="mt-5">
          <CreateDemoButtons />
        </div>
      </Card>

      {overview && overview.licenses.length > 0 ? (
        <Card>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-[17px] font-semibold tracking-tight text-[var(--text)]">
              Recent licenses
            </h2>
            <Link
              href="/account/licenses"
              className="text-[13px] font-medium text-[var(--accent)] hover:underline"
            >
              View all →
            </Link>
          </div>
          <ul className="mt-4 space-y-2">
            {overview.licenses.slice(0, 4).map((lic) => (
              <li
                key={lic.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3.5 py-3"
              >
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text)]">
                    {planTitle(lic.plan)}{" "}
                    <span className="font-normal text-[var(--text-muted)]">· {lic.keyPrefix}</span>
                  </p>
                  <p className="mt-0.5 text-[12px] text-[var(--text-faint)]">
                    {lic.activatedServers}/{lic.serverLimit} servers · expires{" "}
                    {formatDateShort(lic.expiresAt)}
                  </p>
                </div>
                <StatusPill status={lic.status} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  )
}
