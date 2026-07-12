"use client"

import Link from "next/link"
import { Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SoftLockBanner } from "@/components/license/soft-lock-banner"

// ── Welcome state ──────────────────────────────────────────────────────────────

export function WelcomeState({
  hasProfiles,
  locked,
  planLabel,
}: {
  hasProfiles: boolean
  locked?: boolean
  planLabel?: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
      {locked ? (
        <SoftLockBanner
          plan={planLabel ?? "Pro"}
          title={`Full AI Chat is available on ${planLabel ?? "Pro"}.`}
          description={`Free lets you connect and test one Ollama model from the Models page. Upgrade to ${planLabel ?? "Pro"} to chat with files, analyze PDFs and images, and use multiple AI providers.`}
          actions={
            <>
              <Button
                asChild
                size="sm"
                className="bg-[color:var(--arciin-accent,#FF4F12)] text-white hover:bg-[color:var(--arciin-accent,#FF4F12)]/90"
              >
                <Link href="/models">Test Ollama model</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/settings?tab=license">Upgrade to {planLabel ?? "Pro"}</Link>
              </Button>
            </>
          }
        />
      ) : (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/60">
            <Sparkles className="size-6 text-primary" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-foreground">
              {hasProfiles ? "Start a conversation" : "Connect a model first"}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {hasProfiles
                ? "Ask how to use the REST API — I can use your real library ids from this instance. I’ll ask Postman vs curl vs Node vs Python if you want examples."
                : "Go to Models and add an API key to get started."}
            </p>
          </div>
          {!hasProfiles && (
            <Link
              href="/models"
              className="rounded-xl bg-primary px-4 py-2 text-[13px] font-medium text-white hover:bg-primary/90"
            >
              Configure models
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
