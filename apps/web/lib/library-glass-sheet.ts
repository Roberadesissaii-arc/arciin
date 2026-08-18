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
 *
 * Same surface as the AI Chat Library/Files tooltips:
 * zinc-950, zinc-700 border, soft white ring — not the lighter sidebar panel.
 * Fixed width so a long filename never stretches the menu; the title truncates.
 * Pair with `.library-context-menu` so portaled popovers keep these tokens.
 */
export const libraryGlassContextMenu =
  "library-context-menu w-[13.5rem] min-w-[13.5rem] max-w-[13.5rem] overflow-hidden " +
  "rounded-xl border border-zinc-700/90 bg-zinc-950 p-1.5 text-zinc-100 " +
  "shadow-xl shadow-black/40 ring-1 ring-white/10"

/** Menu rows — flat icon + label, no chip tiles. */
export const libraryGlassContextMenuItem =
  "gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium text-zinc-200 " +
  "focus:bg-white/[0.08] focus:text-white data-[variant=destructive]:text-red-400 " +
  "data-[variant=destructive]:focus:bg-red-500/15 data-[variant=destructive]:focus:text-red-300 " +
  "[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-zinc-400 " +
  "focus:[&_svg]:text-zinc-200"

/** Filename header inside the menu — always truncates inside the fixed width. */
export const libraryContextMenuLabel =
  "block w-full min-w-0 truncate px-2.5 pb-1 pt-1 text-[11px] font-medium leading-snug text-zinc-400"
