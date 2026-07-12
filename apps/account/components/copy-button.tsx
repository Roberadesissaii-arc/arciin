"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui"

export function CopyButton({
  value,
  label = "Copy",
  className,
  variant = "outline",
}: {
  value: string
  label?: string
  className?: string
  variant?: "primary" | "outline" | "ghost"
}) {
  const [ok, setOk] = useState(false)

  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setOk(true)
          window.setTimeout(() => setOk(false), 1600)
        } catch {
          /* ignore */
        }
      }}
    >
      {ok ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {ok ? "Copied" : label}
    </Button>
  )
}
