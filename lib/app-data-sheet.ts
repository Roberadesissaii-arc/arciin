/** White bottom sheet for app-data flows (aligned with API key footer pattern). */
export const appDataBottomSheetClass =
  "gap-0 p-0 shadow-none " +
  /* Override Radix bottom `inset-x-0`: do not use `!inset-x-*` or `left`/`right` cannot be centered on sm+. */
  "!bottom-3 !top-auto !left-1/2 !right-auto !-translate-x-1/2 " +
  "!h-auto !max-h-[min(88dvh,560px)] w-[calc(100%-1.5rem)] max-w-lg " +
  "overflow-hidden rounded-2xl border border-zinc-200 " +
  "bg-white text-foreground " +
  "shadow-[0_-12px_48px_-10px_rgba(0,0,0,0.2)]"
