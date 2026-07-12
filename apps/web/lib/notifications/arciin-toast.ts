import { toast as sonnerToast, type ExternalToast } from "sonner"

import {
  notifyError,
  notifyInfo,
  notifySuccess,
  notifyWarning,
} from "@/lib/notifications/toast-actions"

function descriptionFrom(options?: ExternalToast): string | undefined {
  if (!options || typeof options !== "object") return undefined
  const { description } = options
  return typeof description === "string" ? description : undefined
}

function metaFrom(options?: ExternalToast) {
  if (!options || typeof options !== "object") return undefined
  return {
    id: typeof options.id === "string" || typeof options.id === "number" ? options.id : undefined,
    duration: typeof options.duration === "number" ? options.duration : undefined,
  }
}

/** Arciin-styled Sonner — success/error/warning/info use black-badge action toasts. */
export const toast = Object.assign(
  (message: string, options?: ExternalToast) => sonnerToast(message, options),
  {
    success: (message: string, options?: ExternalToast) =>
      notifySuccess(message, descriptionFrom(options), metaFrom(options)),
    error: (message: string, options?: ExternalToast) =>
      notifyError(message, descriptionFrom(options), metaFrom(options)),
    warning: (message: string, options?: ExternalToast) =>
      notifyWarning(message, descriptionFrom(options), metaFrom(options)),
    info: (message: string, options?: ExternalToast) =>
      notifyInfo(message, descriptionFrom(options), metaFrom(options)),
    loading: sonnerToast.loading,
    promise: sonnerToast.promise,
    dismiss: sonnerToast.dismiss,
    custom: sonnerToast.custom,
    message: sonnerToast.message,
  },
)
