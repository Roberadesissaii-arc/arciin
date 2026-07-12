"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { BookOpen, Radio, Sliders } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getRemoteAccessSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

/**
 * Read-only ingress summary for Developer → WebSockets (shown below the edit panel).
 * Install snippets live in Documentation (#remote-access); toggles live in RemoteAccessPanel above.
 */
export function WebSocketsOverview() {
  const q = useQuery({
    queryKey: queryKeys.remoteAccessSettings,
    queryFn: ({ signal }) => getRemoteAccessSettings(signal),
  })
  const d = q.data

  return (
    <div className="relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-gradient-to-b from-zinc-50 via-white to-zinc-50/95 p-6 shadow-sm ring-1 ring-inset ring-zinc-200/60 sm:p-8">
      <div
        className="pointer-events-none absolute inset-0 opacity-100"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% -15%, rgba(255,79,18,0.08) 0%, transparent 52%)",
        }}
      />
      <div className="relative space-y-5">
        <div className="space-y-1.5">
          <h3 className="font-heading text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
            Ingress posture
            <span className="text-primary">.</span>
          </h3>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-700">
            Quick read on how this instance expects traffic. Turn tunnel / proxy flags in the{" "}
            <strong className="font-medium text-zinc-900">WebSockets</strong> card above. Copy install commands from{" "}
            <strong className="font-medium text-zinc-900">Documentation</strong>, then paste the HTTPS origin you
            advertise into <strong className="font-medium text-zinc-900">Settings → Domain</strong>.
          </p>
        </div>

        {d ? (
          <ul className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Mode", value: d.mode.replaceAll("-", " ") },
              { label: "Cloudflare tunnel", value: d.cloudflareTunnelEnabled ? "On" : "Off" },
              { label: "Reverse proxy", value: d.reverseProxyEnabled ? "On" : "Off" },
            ].map((row) => (
              <li
                key={row.label}
                className="rounded-2xl border border-zinc-200/80 bg-white/70 px-3 py-2.5 shadow-sm ring-1 ring-black/[0.03]"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{row.label}</p>
                <p className="mt-1 text-lg font-semibold capitalize text-zinc-900">{row.value}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600">{q.isLoading ? "Loading posture…" : "Could not load posture."}</p>
        )}

        <div className="rounded-2xl border border-zinc-200/80 bg-white/80 p-4 shadow-sm ring-1 ring-black/[0.03] sm:p-5">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            <Radio className="size-3.5 text-primary" aria-hidden />
            Where does the Cloudflare URL come from?
          </p>
          <p className="mt-2 text-sm leading-relaxed text-zinc-700">
            Arciin does not create a hostname for you. When you run{" "}
            <code className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[13px] text-zinc-900">
              cloudflared tunnel --url …
            </code>{" "}
            (quick tunnel), the CLI prints an HTTPS URL ending in{" "}
            <code className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[13px] text-zinc-900">
              trycloudflare.com
            </code>
            —that is the public origin for that session. Copy it into{" "}
            <strong className="text-zinc-900">Settings → Domain → Public base URL</strong>. For a permanent name, use a
            named Cloudflare Tunnel or your own DNS + reverse proxy; the full steps are in Documentation.
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t border-zinc-200/80 pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50">
              <Link href="/docs#remote-access" className="gap-2">
                <BookOpen className="size-4" />
                Documentation
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50">
              <Link href="/settings?tab=domain" className="gap-2">
                <Sliders className="size-4" />
                Domain (public URL)
              </Link>
            </Button>
          </div>
          <Button asChild size="sm" className="bg-primary text-white hover:bg-primary/90 sm:shrink-0">
            <Link href="/developer">Developer hub</Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
