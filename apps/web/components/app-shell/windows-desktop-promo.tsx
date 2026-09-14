"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Monitor } from "lucide-react"

import {
  ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL,
  shouldShowWindowsDesktopPromo,
} from "@arciin/shared"
import {
  persistDesktopPromoDismissed,
  readDesktopPromoHints,
} from "@/lib/desktop-windows-promo"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const BENEFITS = [
  "Find your Arciin server automatically",
  "Back up Desktop, Documents and Pictures",
  "Stay securely paired with this server",
]

export function WindowsDesktopPromo() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(shouldShowWindowsDesktopPromo(readDesktopPromoHints(pathname)))
  }, [pathname])

  function dismiss() {
    persistDesktopPromoDismissed()
    setOpen(false)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss()
      }}
    >
      <AlertDialogContent
        className="max-w-md sm:max-w-md"
        data-testid="windows-desktop-promo"
      >
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-zinc-100 text-zinc-700">
            <Monitor />
          </AlertDialogMedia>
          <AlertDialogTitle>Get Arciin Desktop</AlertDialogTitle>
          <AlertDialogDescription>
            Bring this server to your Windows desktop.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="space-y-2 text-sm text-zinc-600">
          {BENEFITS.map((item) => (
            <li key={item} className="flex gap-2.5">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-zinc-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <AlertDialogFooter className="flex-col sm:flex-col sm:items-stretch">
          <Button asChild>
            <a
              href={ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="windows-desktop-download"
              onClick={dismiss}
            >
              Download for Windows
            </a>
          </Button>
          <AlertDialogCancel data-testid="windows-desktop-continue" onClick={dismiss}>
            Continue in browser
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
