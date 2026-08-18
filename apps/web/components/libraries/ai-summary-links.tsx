"use client"

import { ExternalLink } from "lucide-react"

import { cn } from "@/lib/utils"

function normalizeHref(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed)) return `https://${trimmed}`
  return null
}

/**
 * Summary “Links mentioned” list — one row each, same height, long URLs ellipsis.
 * Used by video and document Summarize so both look identical.
 */
export function AiSummaryLinks({ links }: { links: string[] }) {
  if (links.length === 0) return null

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2">
        <ExternalLink className="size-3.5 text-zinc-400" />
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Links mentioned
        </h4>
      </div>
      <ul className="divide-y divide-zinc-100" data-testid="ai-summary-links">
        {links.map((link) => {
          const href = normalizeHref(link)
          const rowClass = cn(
            "flex h-10 min-w-0 items-center gap-1.5 px-3 text-[12.5px] font-medium",
            "truncate",
          )
          return (
            <li key={link} className="min-w-0">
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link}
                  className={cn(rowClass, "text-primary hover:underline")}
                >
                  <ExternalLink className="size-3 shrink-0" aria-hidden />
                  <span className="min-w-0 truncate">{link}</span>
                </a>
              ) : (
                <span className={cn(rowClass, "text-zinc-700")} title={link}>
                  <span className="min-w-0 truncate">{link}</span>
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
