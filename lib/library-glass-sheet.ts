/**
 * Inset glass panel for library sheets (create folder, move asset, etc.).
 * Width follows default Sheet right rail: 75vw capped by max-w-sm (~24rem).
 */
export const libraryGlassSheetPanel =
  "gap-0 p-0 shadow-none " +
  "!top-2 !right-2 !bottom-2 !left-auto !h-[calc(100dvh-1rem)] " +
  "flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[rgba(8,8,13,0.42)] ring-1 ring-white/[0.06] backdrop-blur-2xl"

/** Same glass material as sheets, for anchored popovers (e.g. header command palette). */
export const libraryGlassCommandPaletteSurface =
  "flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[rgba(8,8,13,0.42)] ring-1 ring-white/[0.06] backdrop-blur-2xl text-[rgba(255,255,255,0.95)] shadow-none"
