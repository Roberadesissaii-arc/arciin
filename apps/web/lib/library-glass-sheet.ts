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
 * Same frosted family as sheets, sized for a compact action list.
 */
export const libraryGlassContextMenu =
  "min-w-[12.75rem] overflow-hidden rounded-xl border border-white/80 " +
  "bg-white/92 p-1.5 text-zinc-900 " +
  "shadow-[0_22px_60px_-18px_rgba(0,0,0,0.32),0_0_0_1px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.95)] " +
  "ring-1 ring-black/[0.04] backdrop-blur-xl backdrop-saturate-150"

/** Menu rows inside `libraryGlassContextMenu`. */
export const libraryGlassContextMenuItem =
  "gap-2.5 rounded-lg px-2 py-2 text-[13px] font-medium text-zinc-700 " +
  "focus:bg-zinc-100 focus:text-zinc-900 data-[variant=destructive]:text-red-600 " +
  "data-[variant=destructive]:focus:bg-red-50 data-[variant=destructive]:focus:text-red-700"
