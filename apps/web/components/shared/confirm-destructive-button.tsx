"use client"

import { useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/**
 * A destructive action behind an in-app confirmation.
 *
 * These actions used to be gated on `window.confirm()`. Inside the Windows
 * desktop client's WebView, in embedded browsers, and in any tab where the
 * person once ticked "prevent this page from creating additional dialogs",
 * `confirm()` returns false without showing anything — so the button looked
 * dead: App Data database, table, and row deletes "did nothing". An
 * AlertDialog is part of the page, works with keyboard and screen readers,
 * and cannot be suppressed.
 */
export function ConfirmDestructiveButton({
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
  pending = false,
  disabled = false,
  children,
  size = "sm",
  variant = "destructive",
  className,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  title: string
  description: ReactNode
  confirmLabel?: string
  /** Resolve (or return) once the work is done; the dialog closes on success. */
  onConfirm: () => unknown | Promise<unknown>
  pending?: boolean
  disabled?: boolean
  children: ReactNode
  size?: "sm" | "default" | "icon" | "icon-sm"
  variant?: "destructive" | "outline" | "ghost"
  className?: string
  "aria-label"?: string
  "data-testid"?: string
}) {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const busy = pending || running

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          className={className}
          disabled={disabled || busy}
          aria-label={ariaLabel}
          data-testid={testId}
        >
          {children}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            data-testid={testId ? `${testId}-confirm` : undefined}
            onClick={async (event) => {
              // Keep the dialog open while the request runs, so a failure is
              // seen in context instead of the dialog vanishing on click.
              event.preventDefault()
              setRunning(true)
              try {
                await onConfirm()
                setOpen(false)
              } catch {
                // The caller's mutation reports the error (toast); stay open.
              } finally {
                setRunning(false)
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * `await confirm({...})` without `window.confirm`, for call sites that decide
 * inside an event handler whether to ask at all. Render `dialog` once.
 */
export function useConfirmDialog() {
  const [state, setState] = useState<{
    title: string
    description: ReactNode
    confirmLabel: string
    resolve: (ok: boolean) => void
  } | null>(null)

  const confirm = (opts: { title: string; description: ReactNode; confirmLabel?: string }) =>
    new Promise<boolean>((resolve) =>
      setState({ ...opts, confirmLabel: opts.confirmLabel ?? "Continue", resolve }),
    )

  const settle = (ok: boolean) => {
    state?.resolve(ok)
    setState(null)
  }

  const dialog = (
    <AlertDialog open={state !== null} onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title}</AlertDialogTitle>
          <AlertDialogDescription>{state?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => settle(true)}>
            {state?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return { confirm, dialog }
}
