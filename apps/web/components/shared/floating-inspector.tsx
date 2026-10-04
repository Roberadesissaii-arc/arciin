"use client"

import type { ReactNode } from "react"
import { ChevronLeft, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SheetClose, SheetDescription, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

/**
 * The floating inspector: one visual shell for the panels that sit beside a
 * library — the asset inspector (Overview, Edit, Assist, Move, Share), Import
 * from link, and the library's own Edit / Move / Share / New folder sheets.
 *
 * It is a token for `SheetContent` plus three parts, not a new Sheet: modal
 * vs non-modal, focus handling and Escape stay the Sheet's (or the caller's)
 * business, and every other sheet in the app keeps its own look.
 *
 *  - inset from the top, right and (on phones) left edge, never touching them;
 *  - height follows the content, up to the viewport minus the inset — a short
 *    form is a short card, not a full-height column with a blank lower half;
 *  - header and footer stay put, the body scrolls;
 *  - 420px wide on desktop (the grid behind it is laid out for that), near-full-width on phones.
 */
export const floatingInspectorPanel =
  "gap-0 p-0 shadow-none " +
  "!inset-auto !top-2 !right-2 !left-2 !h-auto !w-auto max-h-[calc(100dvh-1rem)] " +
  "sm:!left-auto sm:!w-[420px] sm:!max-w-[420px] " +
  "flex min-h-0 flex-col overflow-hidden rounded-[22px] border border-zinc-200/80 " +
  "bg-white/95 text-foreground backdrop-blur-2xl backdrop-saturate-150 " +
  "shadow-[0_24px_70px_-24px_rgba(0,0,0,0.30),0_0_0_1px_rgba(0,0,0,0.03)] " +
  "motion-reduce:!animate-none"

/** For content that is a workspace rather than a form (transcripts): use the full height. */
export const floatingInspectorTall = "!h-[calc(100dvh-1rem)]"

export function InspectorHeader({
  icon,
  eyebrow,
  title,
  titleAttr,
  description,
  descriptionSrOnly = false,
  back,
  onClose,
  closeAsSheetClose = false,
  children,
  className,
}: {
  /** A small tile beside the title; replaced by the back control when `back` is set. */
  icon?: ReactNode
  /** One word above the title ("Video", "Edit"). */
  eyebrow?: ReactNode
  title: ReactNode
  /** Full text for a title that may be truncated. */
  titleAttr?: string
  description?: ReactNode
  descriptionSrOnly?: boolean
  /** "Back to Overview" — the same control in every section. */
  back?: { label: string; onClick: () => void }
  onClose?: () => void
  /** Use the Sheet's own close (modal sheets) instead of `onClose`. */
  closeAsSheetClose?: boolean
  children?: ReactNode
  className?: string
}) {
  const close = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="size-8 shrink-0 rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
      aria-label="Close"
      onClick={closeAsSheetClose ? undefined : onClose}
      data-testid="inspector-close"
    >
      <X className="size-4" aria-hidden />
    </Button>
  )
  return (
    <div className={cn("shrink-0 border-b border-zinc-200/70 px-4 pb-3 pt-3.5", className)}>
      <div className="flex items-start gap-3">
        {back ? (
          <button
            type="button"
            onClick={back.onClick}
            data-testid="asset-panel-back-overview"
            aria-label={`Back to ${back.label}`}
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4F12]/30"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
        ) : icon ? (
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{eyebrow}</p>
          ) : null}
          <SheetTitle
            tabIndex={-1}
            title={titleAttr}
            className="truncate font-heading text-[15.5px] font-semibold leading-snug tracking-tight text-zinc-900 outline-none"
          >
            {title}
          </SheetTitle>
          {description ? (
            <SheetDescription
              className={cn("mt-0.5 text-[12.5px] leading-snug text-zinc-600", descriptionSrOnly && "sr-only")}
            >
              {description}
            </SheetDescription>
          ) : null}
        </div>
        {closeAsSheetClose ? <SheetClose asChild>{close}</SheetClose> : close}
      </div>
      {children}
    </div>
  )
}

export function InspectorBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function InspectorFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex shrink-0 items-center gap-2 border-t border-zinc-200/70 bg-zinc-50/60 px-4 py-3", className)}>
      {children}
    </div>
  )
}

/** A titled group inside the body. */
export function InspectorSection({
  title,
  aside,
  children,
  className,
}: {
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("min-w-0", className)}>
      {title || aside ? (
        <div className="mb-2 flex items-center justify-between gap-3">
          {title ? (
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">{title}</h3>
          ) : (
            <span />
          )}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  )
}
