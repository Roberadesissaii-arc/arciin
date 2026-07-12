"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { TOAST_STYLES, type ToastStyle } from "@arciin/shared"

type ArciinToasterProps = ToasterProps & {
  toastStyle?: ToastStyle
  showIcons?: boolean
}

const GAP_BY_STYLE = Object.fromEntries(
  TOAST_STYLES.map((style) => [style, style === "compact" ? 10 : 16]),
) as Record<ToastStyle, number>

const Toaster = ({
  position = "bottom-right",
  closeButton = false,
  offset,
  mobileOffset = { bottom: 20, right: 16 },
  gap,
  toastStyle = "sonner",
  showIcons = true,
  ...props
}: ArciinToasterProps) => {
  const resolvedGap = gap ?? GAP_BY_STYLE[toastStyle] ?? 12
  // Lift bottom-anchored toasts above the always-bottom-right upload queue panel
  // (its live height is published as --arciin-upload-queue-h by UploadQueue).
  const resolvedOffset =
    offset ??
    ({
      bottom: position.startsWith("bottom")
        ? "calc(24px + var(--arciin-upload-queue-h, 0px))"
        : 24,
      right: 24,
    } as const)

  return (
    <Sonner
      theme={toastStyle === "slate" ? "dark" : "light"}
      className={`toaster group toaster--${toastStyle}`}
      position={position}
      closeButton={closeButton}
      offset={resolvedOffset}
      mobileOffset={mobileOffset}
      gap={resolvedGap}
      visibleToasts={1}
      expand={false}
      icons={
        showIcons
          ? {
              success: <CircleCheckIcon className="arciin-toast-icon-svg" />,
              info: <InfoIcon className="arciin-toast-icon-svg" />,
              warning: <TriangleAlertIcon className="arciin-toast-icon-svg" />,
              error: <OctagonXIcon className="arciin-toast-icon-svg" />,
              loading: <Loader2Icon className="arciin-toast-icon-svg animate-spin text-zinc-400" />,
            }
          : {
              success: null,
              info: null,
              warning: null,
              error: null,
              loading: null,
            }
      }
      toastOptions={{
        classNames: {
          toast: `arciin-toast arciin-toast--${toastStyle}`,
          title: "arciin-toast-title",
          description: "arciin-toast-description",
          icon: "arciin-toast-icon",
          content: "arciin-toast-content",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
