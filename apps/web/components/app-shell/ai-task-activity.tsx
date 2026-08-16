"use client"

/**
 * Work in progress, shown on the row it belongs to.
 *
 * A quiet spinner on **AI Chat** rather than a nav item of its own: the signal
 * belongs where the work lives, and a permanent "AI Tasks" entry earned its own
 * line on screen to describe a different line.
 *
 * The state comes from the server, not from this browser's orchestrator. That
 * is the difference between "my tab is writing a book" and "my account is
 * writing a book" — a second computer signed into the same instance sees the
 * same spinner, the same title and the same chapter.
 */

import Link from "next/link"
import { Loader2 } from "lucide-react"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { useBookRuns } from "@/hooks/use-book-runs"
import { describeBookRun, type BookRunView } from "@/lib/api/book-runs"

const ACCENT = "var(--arciin-accent, #ff4f12)"

/** The runs worth spinning for, whichever session is executing them. */
export function useRunningAiTasks(): BookRunView[] {
  return useBookRuns().active
}

/** Where the AI Chat row points while exactly one thing is running. */
export function aiTaskHref(runs: BookRunView[], fallback: string): string {
  if (runs.length !== 1) return fallback
  return `/chat?c=${encodeURIComponent(runs[0]!.conversationId)}`
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  if (total <= 0) return null
  const percent = Math.min(100, Math.round((done / total) * 100))
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ background: ACCENT, width: `${percent}%` }}
      />
    </div>
  )
}

function RunRow({ run, onNavigate }: { run: BookRunView; onNavigate?: () => void }) {
  return (
    <Link
      href={`/chat?c=${encodeURIComponent(run.conversationId)}`}
      onClick={onNavigate}
      className="-mx-1.5 block rounded-lg px-1.5 py-1.5 transition-colors hover:bg-muted/60"
      data-testid="ai-task-row"
      data-conversation-id={run.conversationId}
    >
      <p className="truncate text-[13px] font-semibold leading-tight text-foreground">
        {run.title}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {run.totalChapters > 0
          ? `${run.writtenChapters} of ${run.totalChapters} chapters`
          : "Planning"}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[12px]" style={{ color: ACCENT }}>
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
        {describeBookRun(run)}
      </p>
      {run.currentChapterTitle ? (
        <p className="mt-0.5 truncate text-[11px] italic text-muted-foreground">
          {run.currentChapterTitle}
        </p>
      ) : null}
      <ProgressBar done={run.writtenChapters} total={run.totalChapters} />
    </Link>
  )
}

/**
 * The spinner, and the detail behind it.
 *
 * A HoverCard opens on hover *and* on focus/tap, so this is not a desktop-only
 * affordance — on a touch device the trigger is a real button and tapping it
 * opens the same card.
 */
export function AiTaskSpinner({
  runs,
  collapsed,
}: {
  runs: BookRunView[]
  collapsed: boolean
}) {
  if (runs.length === 0) return null
  const many = runs.length > 1
  const label = many
    ? `${runs.length} AI tasks running`
    : `${runs[0]!.title} — ${describeBookRun(runs[0]!)}`

  return (
    <HoverCard openDelay={100} closeDelay={150}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          // A button, not a span: hover explains it on a desktop, tapping opens
          // the same card on a phone.
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          className="flex shrink-0 items-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          aria-label={label}
          data-testid="ai-task-spinner"
        >
          <Loader2
            className={collapsed ? "size-3 animate-spin" : "size-3.5 animate-spin"}
            style={{ color: ACCENT }}
            aria-hidden
          />
          {!collapsed && many ? (
            <span
              className="ml-1 text-[10.5px] font-semibold tabular-nums"
              style={{ color: ACCENT }}
            >
              {runs.length}
            </span>
          ) : null}
        </button>
      </HoverCardTrigger>
      {/* Theme tokens: the card is portalled into the page, not the dark nav. */}
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-72 p-3"
        data-testid="ai-task-popover"
      >
        {many ? (
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {runs.length} AI tasks running
          </p>
        ) : null}
        <div className={many ? "space-y-2.5" : undefined}>
          {runs.map((run) => (
            <RunRow key={run.id} run={run} />
          ))}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
