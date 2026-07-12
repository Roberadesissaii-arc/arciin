import { DemoBanner } from "@/components/demo-banner"
import { CopyButton } from "@/components/copy-button"
import { CreateDemoButtons, RevokeButton } from "@/components/license-actions"
import {
  Card,
  FieldLabel,
  PageHeader,
  StatusPill,
  formatDate,
  formatDateShort,
  planTitle,
} from "@/components/ui"
import { fetchAccountOverview } from "@/lib/license-api"

export const dynamic = "force-dynamic"

export default async function LicensesPage() {
  let overview: Awaited<ReturnType<typeof fetchAccountOverview>> | null = null
  let error: string | null = null
  try {
    overview = await fetchAccountOverview()
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load licenses"
  }

  const licenses = overview?.licenses ?? []

  return (
    <>
      <PageHeader
        eyebrow="Keys"
        title="Licenses"
        description="All licenses for this demo customer. Keys are issued by the hosted license server and activated on self-hosted instances."
      />

      <DemoBanner />

      {error ? (
        <Card className="border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-950">{error}</p>
        </Card>
      ) : null}

      <Card>
        <h2 className="font-display text-[17px] font-semibold text-[var(--text)]">
          Create demo license
        </h2>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Pro / Team / Business unlock premium features after activation on a self-hosted server.
        </p>
        <div className="mt-5">
          <CreateDemoButtons />
        </div>
      </Card>

      <div className="space-y-4">
        {licenses.length === 0 && !error ? (
          <Card muted>
            <p className="text-sm text-[var(--text-muted)]">
              No licenses yet. Create a demo Pro license above, then activate it under Settings →
              License on your server.
            </p>
          </Card>
        ) : null}

        {licenses.map((lic) => (
          <Card key={lic.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-xl font-semibold text-[var(--text)]">
                    {planTitle(lic.plan)}
                  </h2>
                  <StatusPill status={lic.status} />
                </div>
                <p className="mt-1 font-mono text-[12px] text-[var(--text-faint)]">{lic.keyPrefix}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {lic.licenseKey ? (
                  <CopyButton value={lic.licenseKey} label="Copy full key" />
                ) : null}
                {lic.status !== "revoked" ? <RevokeButton licenseId={lic.id} /> : null}
              </div>
            </div>

            <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "Server limit",
                  value: `${lic.activatedServers} / ${lic.serverLimit}`,
                },
                { label: "Renewal", value: formatDateShort(lic.expiresAt) },
                { label: "Last check-in", value: formatDate(lic.lastCheckInAt) },
                { label: "Created", value: formatDateShort(lic.createdAt) },
              ].map((row) => (
                <div
                  key={row.label}
                  className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5"
                >
                  <FieldLabel>{row.label}</FieldLabel>
                  <p className="mt-1 text-[13px] font-medium text-[var(--text)]">{row.value}</p>
                </div>
              ))}
            </dl>

            {lic.licenseKey ? (
              <div className="code-block mt-4 p-3">
                <FieldLabel>Full key (demo mode)</FieldLabel>
                <code className="mt-1 block break-all text-[12px] text-[var(--text)]">
                  {lic.licenseKey}
                </code>
              </div>
            ) : null}

            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <FieldLabel>Activations</FieldLabel>
              {lic.activations.length === 0 ? (
                <p className="mt-2 text-[13px] text-[var(--text-muted)]">No servers activated yet.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {lic.activations.map((a) => (
                    <li
                      key={a.id}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2.5 text-[12px]"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-[var(--text)]">
                          {a.instanceName || "Unnamed instance"}
                        </p>
                        <StatusPill status={a.active ? "active" : "inactive"} />
                      </div>
                      <p className="mt-1 font-mono text-[11px] text-[var(--text-faint)]">
                        {a.instanceId}
                      </p>
                      <p className="mt-1 text-[var(--text-muted)]">
                        v{a.instanceVersion || "—"}
                        {a.hostname ? ` · ${a.hostname}` : ""} · last check-in{" "}
                        {formatDate(a.lastCheckInAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
