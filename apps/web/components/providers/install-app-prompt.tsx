"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { Download, X } from "lucide-react"

import {
  createInstallPromptController,
  HIDDEN_INSTALL_PROMPT,
  persistInstallPromptDismissal,
  type InstallPromptController,
  type InstallPromptState,
} from "@/lib/pwa/install-prompt"

export function InstallAppPrompt() {
  const [{ visible, deferred }, setPrompt] = useState<InstallPromptState>(HIDDEN_INSTALL_PROMPT)
  const [installing, setInstalling] = useState(false)
  const controllerRef = useRef<InstallPromptController | null>(null)

  useEffect(() => {
    // Dismissal is checked by the controller each time the browser offers an
    // install, not once here: this component stays mounted across navigation
    // and Chrome fires the event again (see lib/pwa/install-prompt.ts).
    const controller = createInstallPromptController({ onChange: setPrompt })
    controllerRef.current = controller

    window.addEventListener("beforeinstallprompt", controller.handleBeforeInstall)
    window.addEventListener("appinstalled", controller.handleInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", controller.handleBeforeInstall)
      window.removeEventListener("appinstalled", controller.handleInstalled)
      controllerRef.current = null
    }
  }, [])

  function dismiss() {
    // The prompt only becomes visible through the controller, so it is set.
    controllerRef.current?.dismiss()
  }

  async function install() {
    if (!deferred) return
    setInstalling(true)
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      setPrompt(HIDDEN_INSTALL_PROMPT)
      // They closed the native dialog — that is a "not now" too.
      if (choice.outcome === "dismissed") persistInstallPromptDismissal()
    } finally {
      setInstalling(false)
    }
  }

  if (!visible || !deferred) return null

  return (
    <div
      role="dialog"
      aria-label="Install Arciin"
      // Bottom-right: on the left it sat on top of the sidebar nav.
      className="fixed bottom-6 right-6 z-[70] w-[min(22rem,calc(100vw-3rem))] animate-in fade-in slide-in-from-bottom-4 duration-300"
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
