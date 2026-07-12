"use client"

import type { LucideIcon } from "lucide-react"
import { Download, ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ConnectorPathExample } from "@/lib/integrations/connector-paths"

type Step = { title: string; body: string }

export function MediaServerGuideCard({
  title,
  description,
  downloadLabel,
  downloadUrl,
  icon: Icon,
  steps,
  footerNote,
  librariesDirectory,
  connectorPathExamples,
  pathsLoading,
}: {
  title: string
  description: string
  downloadLabel: string
  downloadUrl: string
  icon: LucideIcon
  steps: readonly Step[]
  footerNote: string
  librariesDirectory?: string
  connectorPathExamples?: ConnectorPathExample[]
  pathsLoading?: boolean
}) {
  return (
    <Card className="flex h-full min-h-0 flex-col border-border bg-card shadow-sm">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Icon className="size-5 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-foreground">{title}</CardTitle>
            <CardDescription className="text-zinc-600">{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
        <Button asChild className="w-full shrink-0 bg-primary text-primary-foreground hover:bg-primary/90">
          <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
            <Download className="mr-2 size-4" />
            {downloadLabel}
            <ExternalLink className="ml-2 size-3.5 opacity-80" aria-hidden />
          </a>
        </Button>

        <ol className="flex min-h-0 flex-1 flex-col gap-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="min-h-[6.25rem] shrink-0 space-y-1.5 text-xs">
          {pathsLoading ? (
            <p className="text-muted-foreground">Loading storage paths for this server…</p>
          ) : librariesDirectory ? (
            <>
              <p className="leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">Libraries directory: </span>
                <span className="break-all font-mono text-[11px]">{librariesDirectory}</span>
              </p>
              {connectorPathExamples && connectorPathExamples.length > 0 ? (
                <ul className="space-y-1 text-muted-foreground">
                  {connectorPathExamples.map((ex) => (
                    <li key={ex.libraryName} className="leading-relaxed">
                      <span className="font-medium text-foreground">{ex.libraryName}: </span>
                      <span className="break-all font-mono text-[11px]">{ex.path}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">Storage paths will appear after this instance reports its data directory.</p>
          )}
        </div>

        <p className="min-h-[2.75rem] shrink-0 text-[11px] leading-relaxed text-muted-foreground">{footerNote}</p>
      </CardContent>
    </Card>
  )
}
