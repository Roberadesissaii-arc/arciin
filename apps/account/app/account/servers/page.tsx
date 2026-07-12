import { DemoBanner } from "@/components/demo-banner"
import { DeactivateServerButton } from "@/components/license-actions"
import {
  Card,
  FieldLabel,
  PageHeader,
  StatusPill,
  formatDate,
  planTitle,
} from "@/components/ui"
import { fetchAccountOverview } from "@/lib/license-api"

export const dynamic = "force-dynamic"

export default async function ServersPage() {
  let overview: Awaited<ReturnType<typeof fetchAccountOverview>> | null = null
  let error: string | null = null
  try {
    overview = await fetchAccountOverview()
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load servers"
  }

  const activations = overview?.activations ?? []

  return (
    <>
      <PageHeader
        eyebrow="Fleet"
        title="Activated servers"
        description="Self-hosted instances that activated a license key. Deactivating frees a server slot on that license."
      />

      <DemoBanner />

      {error ? (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-950">{error}</p>
        </Card>
      ) : null}

      {activations.length === 0 && !error ? (
        <Card muted>
          <p className="text-sm text-[var(--text-muted)]">
            No activations yet. Create a license, paste it into the self-hosted app under Settings →
            License, and activate.
          </p>
        </Card>
      ) : null}

      <div className="space-y-3">
        {activations.map((a) => (
          <Card key={a.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-[17px] font-semibold text-[var(--text)]">
                    {a.instanceName || "Unnamed instance"}
                  </h2>
                  <StatusPill status={a.active ? "active" : "inactive"} />
                  <span className="rounded-full border border-[var(--border)] bg-[var(--surface-muted)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {planTitle(a.plan)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-[var(--text-faint)]">{a.instanceId}</p>
              </div>
              {a.active ? (
                <DeactivateServerButton licenseId={a.licenseId} instanceId={a.instanceId} />
              ) : null}
            </div>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Hostname / domain", value: a.hostname || "—" },
                { label: "App version", value: a.instanceVersion || "—" },
                { label: "Activated", value: formatDate(a.activatedAt) },
                { label: "Last check-in", value: formatDate(a.lastCheckInAt) },
              ].map((row) => (
                <div
                  key={row.label}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5"
                >
                  <FieldLabel>{row.label}</FieldLabel>
                  <p className="mt-1 text-[13px] text-[var(--text)]">{row.value}</p>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-[11px] text-[var(--text-faint)]">
              License prefix:{" "}
              <span className="font-mono text-[var(--text-muted)]">{a.licenseKeyPrefix}</span>
              {a.deactivatedAt ? ` · deactivated ${formatDate(a.deactivatedAt)}` : ""}
            </p>
          </Card>
        ))}
      </div>
    </>
  )
}
