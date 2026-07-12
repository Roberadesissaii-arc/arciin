"use client"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  API_KEY_ADMIN_SCOPE,
  summarizeApiKeyScopes,
} from "@/lib/api-keys/scope-display"

export function ApiKeyScopeBadges({
  scopes,
  maxVisible = 3,
  className,
}: {
  scopes: string[]
  maxVisible?: number
  className?: string
}) {
  const { visible, overflow, isAdmin } = summarizeApiKeyScopes(scopes, maxVisible)

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {visible.map((scope) => (
        <Badge
          key={scope}
          variant="outline"
          className={cn(
            "border-border text-[10px] font-medium text-zinc-600",
            isAdmin && scope === API_KEY_ADMIN_SCOPE && "border-primary/30 bg-primary/10 text-primary",
          )}
        >
          {scope}
        </Badge>
      ))}
      {overflow > 0 ? (
        <span className="text-[11px] font-semibold text-zinc-500">+{overflow}</span>
      ) : null}
    </div>
  )
}
