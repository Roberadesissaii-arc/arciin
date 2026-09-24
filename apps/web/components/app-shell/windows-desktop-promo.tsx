"use client"

import { useReducer, useSyncExternalStore } from "react"
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
  "Browse and upload your files from Windows",
  "Stay securely paired with this server",
]

const subscribeNever = () => () => {}

export function WindowsDesktopPromo() {
  const pathname = usePathname()
  // Re-read the browser hints after a dismissal; they live outside React.
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  /**
   * The hints come from the browser (user agent, a persisted dismissal), which
   * the server cannot see. useSyncExternalStore reads them after hydration —
   * the server snapshot is "closed" — instead of setting state in an effect.
   */
  const open = useSyncExternalStore(
    subscribeNever,
    () => shouldShowWindowsDesktopPromo(readDesktopPromoHints(pathname)),
    () => false,
  )

  function dismiss() {
    persistDesktopPromoDismissed()
    rerender()
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
