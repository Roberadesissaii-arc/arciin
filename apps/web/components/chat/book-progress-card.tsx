"use client"

import { Check, Loader2, MonitorSmartphone, Pause, Play, RotateCcw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { countWords } from "@/lib/chat/book/book-parser"
import { bookProgress, nextChapterNumber, type BookProject } from "@/lib/chat/book/types"
import { cn } from "@/lib/utils"

/**
 * One card for the whole book, updated in place.
 *
 * The old flow posted a full assistant message after every chapter — the same
 * six lines about word counts and opening the Canvas, twelve times. Automatic
 * writing would have turned that into a wall. A book is one long-running task,
 * so it gets one thing on screen that changes, the way an upload does.
 */
export function BookProgressCard({
  project,
  manuscript,
  streamingChapter,
  onPause,
  onResume,
  onRetry,
  onOpenManuscript,
  className,
  /**
   * Another computer is writing this book, and what it is doing right now.
   *
   * Without it this card would offer Pause — and, because an observed run is
   * held in a non-generating status, label that button "Stopping…". Neither is
   * true: this session is not running the book and cannot stop it. Watching is
   * the honest state, so it gets said out loud.
   */
  remote,
}: {
  project: BookProject
  manuscript: string
  streamingChapter: number | null
  onPause: () => void
  onResume: () => void
  onRetry: () => void
  onOpenManuscript: () => void
  className?: string
  remote?: { executedElsewhere: boolean; description: string } | null
}) {
  const { done, total, percent } = bookProgress(project)
  const words = countWords(manuscript)
  const next = nextChapterNumber(project)
  const observing = Boolean(remote?.executedElsewhere)
  const running = !observing && (project.status === "writing" || project.status === "stopping")
  const complete = project.status === "completed"

  const headline =
    complete
      ? "is complete"
      : project.status === "failed"
        ? "hit a problem"
        : observing
          ? remote!.description
          : project.status === "paused"
            ? "is paused"
            : "Writing your book"

  return (
    <div
      // A stable hook for the acceptance suite. Matching this card by its copy
      // meant a locator that also matched the model's own reasoning trace.
      data-testid="book-progress-card"
      data-book-status={project.status}
      className={cn(
        "rounded-2xl border border-border bg-card/60 p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            📖 {project.title}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {complete || project.status === "failed" || project.status === "paused" || observing
              ? headline
              : "Writing your book"}
          </p>
        </div>
        {observing ? (
          // No control, because this session holds no claim on the run. The
          // computer doing the writing is the one that can pause it.
          <span
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground"
            data-testid="book-observer-badge"
          >
            <MonitorSmartphone className="size-3.5" />
            On another computer
          </span>
        ) : running ? (
          <Button size="sm" variant="outline" onClick={onPause} className="shrink-0 gap-1.5">
            <Pause className="size-3.5" />
            {project.status === "stopping" ? "Stopping…" : "Pause"}
          </Button>
        ) : project.status === "failed" ? (
          <Button size="sm" onClick={onRetry} className="shrink-0 gap-1.5">
            <RotateCcw className="size-3.5" />
            Retry Chapter {next}
          </Button>
        ) : project.status === "paused" ? (
          <Button size="sm" onClick={onResume} className="shrink-0 gap-1.5">
            <Play className="size-3.5" />
            Resume
          </Button>
        ) : null}
      </div>

      <div className="mt-3 flex items-baseline gap-2 text-[12px] text-muted-foreground">
        <span className="font-semibold text-foreground">
          {done} / {total || "?"} chapters
        </span>
        {words > 0 ? <span>· {words.toLocaleString()} words</span> : null}
        {total > 0 && !complete ? <span>· {percent}%</span> : null}
      </div>

      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${total > 0 ? percent : 0}%` }}
        />
      </div>

      {project.chapters.length > 0 ? (
        <ol className="mt-3 space-y-1">
          {project.chapters.map((chapter) => {
            const written = chapter.number <= project.written
            const active = streamingChapter === chapter.number
            return (
              <li
                key={chapter.number}
                className={cn(
                  "flex items-center gap-2 text-[12px]",
                  written
                    ? "text-muted-foreground"
                    : active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground/60",
                )}
              >
                <span className="flex size-4 shrink-0 items-center justify-center">
                  {written ? (
                    <Check className="size-3.5 text-emerald-500" />
                  ) : active ? (
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                  ) : (
                    <span className="size-1.5 rounded-full border border-current opacity-50" />
                  )}
                </span>
                <span className="min-w-0 truncate">
                  {chapter.number}. {chapter.title}
                  {active ? " — writing…" : ""}
                </span>
              </li>
            )
          })}
        </ol>
      ) : null}

      {project.status === "paused" && total > 0 && next <= total ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Next: Chapter {next}
          {project.chapters.find((c) => c.number === next)?.title
            ? ` — ${project.chapters.find((c) => c.number === next)!.title}`
            : ""}
        </p>
      ) : null}

      {project.status === "failed" && project.lastError ? (
        <p className="mt-3 flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>{project.lastError}</span>
        </p>
      ) : null}

      <button
        type="button"
        onClick={onOpenManuscript}
        className="mt-3 text-[12px] font-medium text-primary hover:underline"
      >
        Open manuscript
      </button>
    </div>
  )
}
