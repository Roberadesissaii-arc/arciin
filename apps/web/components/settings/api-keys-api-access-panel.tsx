"use client"

import { useState } from "react"
import Link from "next/link"
import { BookOpen, Code2, Copy, Radio } from "lucide-react"

import { CreateApiKeyDialog } from "@/components/settings/create-api-key-dialog"
import { Button } from "@/components/ui/button"
import { getBrowserRestApiBase } from "@/lib/api/rest-api-base"
import { copyToClipboard } from "@/lib/utils/clipboard"

export function ApiKeysApiAccessPanel() {
  // Lazy initializer already reads the browser origin on mount — no effect needed.
  const [restBase] = useState(() => getBrowserRestApiBase())

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/30 px-5 py-4">
        <h3 className="text-sm font-semibold text-foreground">API access</h3>
        <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-zinc-500">
          Use your instance REST API from scripts, CI, or another server. Send a scoped key on every request — browser
          session cookies are for the UI only.
        </p>
      </div>

      <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Base URL</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-xl border border-border bg-muted/50 px-3 py-2.5 font-mono text-[12px] text-foreground">
              {restBase}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 border-border bg-card text-foreground hover:bg-muted/50"
              onClick={() => void copyToClipboard(restBase, "Base URL")}
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Append endpoint paths from the docs — for example{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">/libraries</code>,{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">/assets</code>,{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">/uploads</code>.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Authorization</p>
          <code className="block rounded-xl border border-border bg-muted/50 px-3 py-2.5 font-mono text-[12px] text-foreground">
            Authorization: Bearer &lt;your-key&gt;
          </code>
          <p className="text-[11px] leading-relaxed text-zinc-500">
            Create a key below, copy it once, and store it server-side. Rotate or revoke from the table when access
            changes.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 border-border bg-card text-[12px] text-foreground hover:bg-muted/50"
          >
            <Link href="/docs#api-keys">
              <BookOpen className="size-3.5" />
              API documentation
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 border-border bg-card text-[12px] text-foreground hover:bg-muted/50"
          >
            <Link href="/docs#example-scripts">
              <Code2 className="size-3.5" />
              Example scripts
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="h-8 border-border bg-card text-[12px] text-foreground hover:bg-muted/50"
          >
            <Link href="/docs#events">
              <Radio className="size-3.5" />
              Event catalogue
            </Link>
          </Button>
        </div>
        <CreateApiKeyDialog />
      </div>
    </div>
  )
}
