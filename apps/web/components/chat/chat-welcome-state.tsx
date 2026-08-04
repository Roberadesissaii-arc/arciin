"use client"

import Link from "next/link"
import { Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SoftLockBanner } from "@/components/license/soft-lock-banner"
import {
  ChatTemplateCards,
  type ChatTemplate,
} from "@/components/chat/chat-template-cards"

// ── Welcome state ──────────────────────────────────────────────────────────────

export function WelcomeState({
  hasProfiles,
  locked,
  planLabel,
  onSelectTemplate,
}: {
  hasProfiles: boolean
  locked?: boolean
  planLabel?: string
  onSelectTemplate?: (template: ChatTemplate) => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6 sm:py-12">
      {locked ? (
        <div className="flex w-full max-w-5xl flex-col items-center gap-8">
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
          <ChatTemplateCards disabled onSelect={() => {}} />
        </div>
      ) : !hasProfiles ? (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/60">
            <Sparkles className="size-6 text-primary" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-foreground">Connect a model first</p>
            <p className="mt-1 max-w-md text-[13px] text-muted-foreground">
              Go to Models and add an API key or Ollama profile to get started.
            </p>
          </div>
          <Link
            href="/models"
            className="rounded-xl bg-primary px-4 py-2 text-[13px] font-medium text-white hover:bg-primary/90"
          >
            Configure models
          </Link>
        </div>
      ) : onSelectTemplate ? (
        <ChatTemplateCards onSelect={onSelectTemplate} />
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/60">
            <Sparkles className="size-6 text-primary" />
          </div>
          <p className="text-[15px] font-semibold text-foreground">Start a conversation</p>
        </div>
      )}
    </div>
  )
}
