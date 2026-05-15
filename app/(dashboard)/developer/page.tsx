import Link from "next/link"
import { ArrowRight, BookOpen, Code2, Puzzle, Router, Webhook } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { DeveloperPanel } from "@/components/settings/developer-panel"

const TOOLS = [
  {
    href: "/developer/api-keys",
    title: "API keys",
    description: "Create, rotate, and revoke keys with scopes for automation and agents.",
    icon: Puzzle,
    foot: "Bearer authentication",
  },
  {
    href: "/developer/webhooks",
    title: "Webhooks",
    description: "Outbound HTTPS subscriptions for asset, library, and job events.",
    icon: Webhook,
    foot: "Signed deliveries",
  },
  {
    href: "/developer/web-sockets",
    title: "WebSockets",
    description: "Tunnel and reverse-proxy flags, local vs public URL context, and ingress notes.",
    icon: Router,
    foot: "Configure ingress",
  },
  {
    href: "/docs",
    title: "Documentation",
    description: "REST envelopes, realtime events, and setup guides for this instance.",
    icon: BookOpen,
    foot: "Manual",
  },
] as const

export default function DeveloperHubPage() {
  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <DashboardPageIntro
        title="Developer"
        subtitle="API · webhooks · ingress"
        description="Use the cards to open tools. The section below explains authentication (browser vs API keys) and how Socket.IO differs from webhooks. Instance-only settings stay under Settings."
        stats={[
          { label: "API", value: "Keys + REST" },
          { label: "Events", value: "Webhooks" },
          { label: "Ingress", value: "WebSockets" },
          { label: "Manual", value: "Docs" },
        ]}
        badge={
          <div className="flex shrink-0 items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
            <Code2 className="size-3.5" aria-hidden />
            Dev tools
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {TOOLS.map(({ href, title, description, icon: Icon, foot }) => (
          <Link
            key={href}
            href={href}
            className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm ring-1 ring-black/[0.03] transition-all hover:border-primary/35 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60 text-primary shadow-inner">
                  <Icon className="size-4" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-foreground">{title}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
                </div>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border/80 pt-3">
              <span className="text-[11px] font-medium text-muted-foreground">{foot}</span>
              <span className="rounded-lg border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-semibold text-foreground">
                Open
              </span>
            </div>
          </Link>
        ))}
      </div>

      <DeveloperPanel />
    </div>
  )
}
