"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({
  position = "bottom-right",
  closeButton = false,
  offset = { bottom: 24, right: 24 },
  mobileOffset = { bottom: 20, right: 16 },
  gap = 12,
  ...props
}: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      position={position}
      closeButton={closeButton}
      offset={offset}
      mobileOffset={mobileOffset}
      gap={gap}
      icons={{
        success: (
          <CircleCheckIcon className="size-[18px]" />
        ),
        info: (
          <InfoIcon className="size-[18px]" />
        ),
        warning: (
          <TriangleAlertIcon className="size-[18px]" />
        ),
        error: (
          <OctagonXIcon className="size-[18px]" />
        ),
        loading: (
          <Loader2Icon className="size-[18px] animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
