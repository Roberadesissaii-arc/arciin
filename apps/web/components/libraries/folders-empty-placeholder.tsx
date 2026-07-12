/** Shown when a library has no folders yet — keeps layout consistent across library pages. */
export function FoldersEmptyPlaceholder() {
  return (
    <div className="flex min-h-[4.5rem] items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/[0.08] px-4 py-5">
      <p className="text-center text-[13px] leading-snug text-muted-foreground">
        No folders yet. Use <span className="font-medium text-foreground">New folder</span> above to
        organize this library.
      </p>
    </div>
  )
}
