"use client"

import { toast } from "@/lib/notifications/arciin-toast"

type CopyableField = HTMLInputElement | HTMLTextAreaElement

function copyWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") {
    return false
  }

  const el = document.createElement("textarea")
  el.value = text
  el.setAttribute("readonly", "")
  el.style.cssText =
    "position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:none;outline:none;box-shadow:none;background:transparent"
  document.body.appendChild(el)
  el.focus()
  el.select()
  el.setSelectionRange(0, text.length)

  let ok = false
  try {
    ok = document.execCommand("copy")
  } finally {
    document.body.removeChild(el)
  }

  return ok
}

function selectFieldValue(field: CopyableField) {
  field.focus()
  field.select()
  field.setSelectionRange(0, field.value.length)
}

/**
 * Copy from a visible readonly field — matches manual select + Ctrl+C behavior.
 */
export function copyFromField(field: CopyableField | null | undefined, text?: string): boolean {
  const value = text ?? field?.value ?? ""
  if (!value) {
    return false
  }

  if (field) {
    selectFieldValue(field)
    try {
      if (document.execCommand("copy")) {
        return true
      }
    } catch {
      // fall through
    }
  }

  return copyWithExecCommand(value)
}

/**
 * Copy immediately inside a pointer/click handler.
 */
export function copyTextNow(text: string, field?: CopyableField | null): boolean {
  if (!text) {
    return false
  }

  if (field && copyFromField(field, text)) {
    return true
  }

  if (copyWithExecCommand(text)) {
    return true
  }

  if (typeof navigator !== "undefined" && window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      void navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  return false
}

export async function copyTextWithFallback(text: string, field?: CopyableField | null): Promise<boolean> {
  if (copyTextNow(text, field)) {
    return true
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through
    }
  }

  return copyWithExecCommand(text)
}

export async function copyToClipboard(text: string, label?: string, field?: CopyableField | null): Promise<boolean> {
  const successMessage = label ? `${label} copied` : "Copied to clipboard"
  const ok = await copyTextWithFallback(text, field)

  if (ok) {
    toast.success(successMessage, { description: "Saved to your clipboard." })
    return true
  }

  toast.error("Could not copy", {
    description: "Select the field and press Ctrl+C (or Cmd+C).",
  })
  return false
}

export function formatApiKeyPreview(key: string, head = 14, tail = 8) {
  if (key.length <= head + tail + 3) {
    return key
  }
  return `${key.slice(0, head)}…${key.slice(-tail)}`
}
