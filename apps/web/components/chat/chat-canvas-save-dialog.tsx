"use client"

import { FileText, FileType2, Loader2, Save } from "lucide-react"

import {
  canvasExportLabel,
  type CanvasExportFormat,
} from "@/lib/chat/canvas-export"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const OPTIONS: {
  format: CanvasExportFormat
  hint: string
  icon: typeof FileText
}[] = [
  {
    format: "pdf",
    hint: "Best for reading and printing. Opens cleanly in Documents.",
    icon: FileType2,
  },
  {
    format: "doc",
    hint: "Word-compatible document (opens in Microsoft Word / LibreOffice).",
    icon: FileText,
  },
  {
    format: "md",
    hint: "Markdown source — keeps headings for editing later.",
    icon: FileText,
  },
]

type ChatCanvasSaveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  saving?: boolean
  selected: CanvasExportFormat
  onSelect: (format: CanvasExportFormat) => void
  onConfirm: () => void
}

export function ChatCanvasSaveDialog({
  open,
  onOpenChange,
  title,
  saving = false,
  selected,
  onSelect,
  onConfirm,
}: ChatCanvasSaveDialogProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[min(90dvh,32rem)] w-full max-w-lg rounded-t-2xl border border-border bg-card p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border px-5 py-4 text-left">
          <SheetTitle className="text-[15px] font-semibold">Save to Documents</SheetTitle>
          <SheetDescription className="text-[12px] text-muted-foreground">
            Choose a format for{" "}
            <span className="font-medium text-foreground">{title || "this draft"}</span>.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-2 px-4 py-4">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon
            const on = selected === opt.format
            return (
              <button
                key={opt.format}
                type="button"
                disabled={saving}
                onClick={() => onSelect(opt.format)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors",
                  on
                    ? "border-primary/40 bg-primary/10"
                    : "border-border bg-card hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg",
                    on ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-foreground">
                    {canvasExportLabel(opt.format)}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                    {opt.hint}
                  </span>
                </span>
                <span
                  className={cn(
                    "mt-1 size-4 shrink-0 rounded-full border-2",
                    on ? "border-primary bg-primary" : "border-muted-foreground/40",
                  )}
                  aria-hidden
                />
              </button>
            )
          })}
        </div>

        <SheetFooter className="flex-row gap-2 border-t border-border px-4 py-3 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="gap-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-[color:var(--arciin-accent-hover,#FF6A33)]"
            disabled={saving}
            onClick={() => onConfirm()}
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            {saving ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
