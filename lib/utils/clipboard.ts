"use client"

import { toast } from "sonner"

/**
 * Copy text to the clipboard. Falls back to document.execCommand when
 * navigator.clipboard is unavailable (HTTP on non-localhost — e.g. LAN IPs).
 */
export async function copyToClipboard(text: string, label?: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const el = document.createElement("textarea")
      el.value = text
      el.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none"
      document.body.appendChild(el)
      el.focus()
      el.select()
      const ok = document.execCommand("copy")
      document.body.removeChild(el)
      if (!ok) throw new Error("execCommand failed")
    }
    if (label) toast.success(`${label} copied`)
  } catch {
    toast.error("Could not copy to clipboard")
  }
}
