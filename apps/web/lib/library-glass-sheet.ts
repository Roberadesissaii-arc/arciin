/**
 * Inset glass panel for library sheets (create folder, move asset, etc.).
 * Width follows default Sheet right rail: 75vw capped by max-w-sm (~24rem).
 * Frosted glass: translucent white + blur + soft shadow (reads on light dashboard).
 */
export const libraryGlassSheetPanel =
  "gap-0 p-0 shadow-none " +
  "!top-2 !right-2 !bottom-2 !left-auto !h-[calc(100dvh-1rem)] " +
  "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/70 " +
  "bg-white/72 text-foreground shadow-[0_28px_90px_-24px_rgba(0,0,0,0.28),0_0_0_1px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.92)] " +
  "ring-1 ring-black/[0.05] backdrop-blur-2xl backdrop-saturate-150"

/** Command palette + anchored popovers — same glass language as sheets. */
export const libraryGlassCommandPaletteSurface =
  "flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-white/70 " +
  "bg-white/76 text-foreground shadow-[0_22px_70px_-20px_rgba(0,0,0,0.26),0_0_0_1px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.92)] " +
  "ring-1 ring-black/[0.05] backdrop-blur-2xl backdrop-saturate-150"

/**
 * Right-click menus on library cards/folders.
 * Matches the dark sidebar language — compact, not the white glass sheets.
 * Pair with the `.library-context-menu` CSS token so portaled popovers do not
 * inherit the light `dashboard-main` variables.
 */
export const libraryGlassContextMenu =
  "library-context-menu min-w-[11.5rem] overflow-hidden rounded-xl border border-white/10 " +
  "bg-[#18181B] p-1 text-zinc-200 " +
  "shadow-[0_18px_48px_-16px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.04)] " +
  "ring-1 ring-white/[0.06]"

/** Menu rows inside `libraryGlassContextMenu`. */
export const libraryGlassContextMenuItem =
  "gap-2 rounded-md px-1.5 py-1.5 text-[12.5px] font-medium text-zinc-300 " +
  "focus:bg-white/[0.08] focus:text-white data-[variant=destructive]:text-red-400 " +
  "data-[variant=destructive]:focus:bg-red-500/15 data-[variant=destructive]:focus:text-red-300"

/** Icon chip inside a dark context-menu row. */
export const libraryContextMenuIcon =
  "flex size-6 shrink-0 items-center justify-center rounded-md bg-white/[0.08] text-zinc-400"
