import Link from "next/link"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function apiBaseDisplay() {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim()
  if (raw) return raw
  return "/api"
}

function socketUrlDisplay() {
  return process.env.NEXT_PUBLIC_SOCKET_URL?.trim() || "http://localhost:4000"
}

/**
 * Reference copy for the Developer hub only — complements the four tool cards above
 * (no duplicate “open webhooks” tiles).
 */
export function DeveloperPanel() {
  const apiBase = apiBaseDisplay()
  const socketUrl = socketUrlDisplay()

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">How access and events work</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          The cards above open the tools. This section explains how authentication and realtime data differ so you know
          which path to use.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">Authentication</CardTitle>
            <CardDescription className="text-zinc-600">
              Browser sessions and API keys are separate; use the right credential for each surface.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">Arciin UI (browser)</p>
              <p className="mt-1">
                After sign-in, the app uses an <strong className="text-foreground">httpOnly session cookie</strong>.
                It is not exposed to JavaScript and is not a substitute for an API key in scripts or servers.
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground">REST and automation</p>
              <p className="mt-1">
                Create a scoped key under{" "}
                <Link href="/developer/api-keys" className="font-medium text-primary underline-offset-4 hover:underline">
                  API keys
                </Link>{" "}
                and send it on every request:
              </p>
              <code className="mt-2 block rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-[12px] text-foreground">
                Authorization: Bearer &lt;your-key&gt;
              </code>
            </div>
            <div>
              <p className="font-medium text-foreground">HTTP base for this UI</p>
              <p className="mt-1">
                The Next.js app proxies API routes from the browser. From this origin, calls go to{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">{apiBase}</code>
                {apiBase.startsWith("http") ? " (absolute)" : " (relative to this host)"}.
              </p>
            </div>
            <p className="text-xs text-zinc-500">
              Keys are stored hashed; you only see the plaintext once at creation. See{" "}
              <Link href="/docs#api-keys" className="font-medium text-primary underline-offset-4 hover:underline">
                Documentation → API keys
              </Link>
              .
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">Realtime and event stream</CardTitle>
            <CardDescription className="text-zinc-600">
              Live UI updates use Socket.IO; server-to-server automation uses webhooks — different transports, same event
              names where applicable.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">Socket.IO (dashboard)</p>
              <p className="mt-1">
                While a user is signed in, the shell can open a Socket.IO connection for upload progress, jobs, and
                activity. Configure the client URL with{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
                  NEXT_PUBLIC_SOCKET_URL
                </code>{" "}
                (this build defaults to{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{socketUrl}</code>
                ).
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                Use for interactive apps, not for replacing webhooks on a backend with no browser session.
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground">Webhooks (your servers)</p>
              <p className="mt-1">
                Register HTTPS endpoints to receive <strong className="text-foreground">signed POST</strong> payloads
                when things change. Ideal for CI, billing, or fan-out to other systems.
              </p>
              <p className="mt-2">
                <Link href="/developer/webhooks" className="font-medium text-primary underline-offset-4 hover:underline">
                  Open Webhooks
                </Link>{" "}
                ·{" "}
                <Link href="/docs#webhooks" className="font-medium text-primary underline-offset-4 hover:underline">
                  Docs → Webhooks
                </Link>
              </p>
            </div>
            <div>
              <p className="font-medium text-foreground">Event catalogue</p>
              <p className="mt-1">
                Shared string names for Socket.IO and webhook subscriptions are listed in the manual.
              </p>
              <p className="mt-2">
                <Link href="/docs#events" className="font-medium text-primary underline-offset-4 hover:underline">
                  Documentation → Event catalogue
                </Link>{" "}
                ·{" "}
                <Link href="/docs#realtime" className="font-medium text-primary underline-offset-4 hover:underline">
                  Realtime (Socket.IO)
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
