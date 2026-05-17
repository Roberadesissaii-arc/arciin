"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { TOAST_STYLES, type ToastStyle } from "@arciin/shared"

type ArciinToasterProps = ToasterProps & {
  toastStyle?: ToastStyle
  showIcons?: boolean
}

const GAP_BY_STYLE = Object.fromEntries(
  TOAST_STYLES.map((style) => [style, style === "compact" ? 8 : 12]),
) as Record<ToastStyle, number>

const Toaster = ({
  position = "bottom-right",
  closeButton = false,
  offset = { bottom: 24, right: 24 },
  mobileOffset = { bottom: 20, right: 16 },
  gap,
  toastStyle = "sonner",
  showIcons = true,
  ...props
}: ArciinToasterProps) => {
  const resolvedGap = gap ?? GAP_BY_STYLE[toastStyle] ?? 12

  return (
    <Sonner
      theme="light"
      className={`toaster group toaster--${toastStyle}`}
      position={position}
      closeButton={closeButton}
      offset={offset}
      mobileOffset={mobileOffset}
      gap={resolvedGap}
      visibleToasts={4}
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
