"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { Download, X } from "lucide-react"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

const DISMISS_KEY = "arciin.install-dismissed"

function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function InstallAppPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    if (localStorage.getItem(DISMISS_KEY) === "1") return

    function onBeforeInstall(event: Event) {
      // Prevent the mini-infobar so we can show our own, on-brand prompt.
      event.preventDefault()
      setDeferred(event as BeforeInstallPromptEvent)
      setVisible(true)
    }

    function onInstalled() {
      setVisible(false)
      setDeferred(null)
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  function dismiss() {
    setVisible(false)
    try {
      localStorage.setItem(DISMISS_KEY, "1")
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }

  async function install() {
    if (!deferred) return
    setInstalling(true)
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      setDeferred(null)
      setVisible(false)
      if (choice.outcome === "dismissed") {
        // They closed the native dialog — don't nag again this session.
        try {
          localStorage.setItem(DISMISS_KEY, "1")
        } catch {
          // ignore
        }
      }
    } finally {
      setInstalling(false)
    }
  }

  if (!visible || !deferred) return null

  return (
    <div
      role="dialog"
      aria-label="Install Arciin"
      className="fixed bottom-6 left-6 z-[70] w-[min(22rem,calc(100vw-3rem))] animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      <div className="relative overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-2.5 top-2.5 flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-3 pr-6">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-700 bg-black">
            <Image src="/icon-192.png" alt="" width={44} height={44} className="size-11" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Install Arciin</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-zinc-400">
              Run Arciin in its own window — opens straight from your desktop, just like an app.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            disabled={installing}
            onClick={() => void install()}
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-lg bg-[#FF4F12] text-[13px] font-semibold text-white transition-colors hover:bg-[#FF6A33] disabled:opacity-60"
          >
            <Download className="size-4" aria-hidden />
            {installing ? "Installing…" : "Install app"}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-zinc-700 px-3 text-[13px] font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
